package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

// attachmentIDPattern keeps the opaque id space small and unguessable-looking.
// The Server only ever accepts ids it learned from a transcript, so this is a
// cheap first gate rather than a security boundary.
var attachmentIDPattern = regexp.MustCompile(`^att_[A-Za-z0-9_-]{8,64}$`)

// attachmentFetchTimeout gives the Connector room to read a large file from
// disk and upload it before the command is declared failed.
const attachmentFetchTimeout = 60 * time.Second

// inlineMIMEs may be rendered in place by the App. Everything else is served
// as a download, so an unexpected type cannot execute in a web view.
var inlineMIMEs = map[string]bool{
	"image/png":     true,
	"image/jpeg":    true,
	"image/webp":    true,
	"image/gif":     true,
	"text/plain":    true,
	"text/markdown": true,
}

// nonRetryableAttachmentErrors are the desktop-side verdicts that will not
// change by asking again; the App shows the reason instead of a retry button.
var nonRetryableAttachmentErrors = map[string]bool{
	protocol.AttachmentErrorUnknown:     true,
	protocol.AttachmentErrorUnavailable: true,
	protocol.AttachmentErrorChanged:     true,
	protocol.AttachmentErrorTooLarge:    true,
	protocol.AttachmentErrorDenied:      true,
}

// attachmentBlobs is the on-disk half of attachment storage: content-addressed
// files under one directory. Metadata lives in the server database, bytes never do.
type attachmentBlobs struct {
	dir string
}

func (b attachmentBlobs) path(sha string) string {
	return filepath.Join(b.dir, sha[:2], sha)
}

// write stores bytes for one digest atomically so a reader never observes a
// half-written blob.
func (b attachmentBlobs) write(sha string, data []byte) error {
	target := b.path(sha)
	if _, err := os.Stat(target); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat attachment blob %s: %w", sha, err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return fmt.Errorf("create attachment blob directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".upload-*")
	if err != nil {
		return fmt.Errorf("create attachment blob temp file: %w", err)
	}
	name := temporary.Name()
	defer func() { _ = os.Remove(name) }()
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write attachment blob %s: %w", sha, err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync attachment blob %s: %w", sha, err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close attachment blob %s: %w", sha, err)
	}
	if err := os.Rename(name, target); err != nil {
		return fmt.Errorf("publish attachment blob %s: %w", sha, err)
	}
	return nil
}

// open returns the stored blob for a digest.
func (b attachmentBlobs) open(sha string) (*os.File, error) {
	return os.Open(b.path(sha))
}

// attachmentsEnabled reports whether the feature is on at all. "off" makes the
// endpoints behave like an older Server that never heard of attachments.
func (s *Server) attachmentsEnabled() bool {
	return s.config.AttachmentsMode != attachmentsModeOff
}

func (s *Server) attachmentRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/mobile/attachments/{attachmentId}", s.mobileAuth(s.handleMobileAttachment))
	mux.HandleFunc("POST /v1/connector/attachments/{attachmentId}", s.handleConnectorAttachmentUpload)
}

// handleMobileAttachment serves the bytes of one declared attachment.
//
// Authorization is deliberately reversed: the Server looks the row up by id and
// authorizes against the ownership recorded on that row, never against device
// or workspace values supplied by the phone. An id from one session therefore
// cannot be read through another session's grant.
func (s *Server) handleMobileAttachment(w http.ResponseWriter, r *http.Request) {
	if !s.attachmentsEnabled() {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "attachments are disabled", false))
		return
	}
	attachmentID := r.PathValue("attachmentId")
	if !attachmentIDPattern.MatchString(attachmentID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "invalid attachmentId", false))
		return
	}
	row, err := s.store.SessionAttachment(r.Context(), attachmentID)
	if err != nil {
		if errors.Is(err, store.ErrAttachmentNotFound) {
			writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "attachment not found", false))
			return
		}
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load attachment", true))
		return
	}
	actor, commandError := s.authorizeMobileSession(r, row.DeviceID, row.WorkspaceID, row.SessionID, "read")
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if row.ErrorCode == protocol.AttachmentErrorTooLarge {
		writeAPIError(w, protocol.NewError(protocol.CodePayloadTooLarge, "attachment exceeds the configured size limit", false))
		return
	}
	// A sticky desktop verdict is final regardless of the state it left the row
	// in: retrying a denied or changed file only repeats the same refusal.
	if nonRetryableAttachmentErrors[row.ErrorCode] {
		writeAttachmentFailure(w, row)
		return
	}
	switch row.State {
	case protocol.AttachmentStateReady:
		s.serveAttachmentBlob(w, r, row)
		return
	case protocol.AttachmentStateFetching:
		writeAttachmentPending(w)
		return
	case protocol.AttachmentStateFailed:
		// A retryable verdict may be asked again (sticky ones returned above).
	case protocol.AttachmentStateUnavailable:
		// The blob expired or was evicted; the declaration may still resolve.
	case protocol.AttachmentStateKnown:
		// First request for this file.
	default:
		writeAttachmentFailure(w, row)
		return
	}
	if row.Bytes > s.config.MaxAttachmentBytes {
		// Refuse before asking the desktop to read an oversized file.
		_ = s.store.FailAttachment(r.Context(), row.ID, protocol.AttachmentErrorTooLarge, nowUTC())
		writeAPIError(w, protocol.NewError(protocol.CodePayloadTooLarge, "attachment exceeds the configured size limit", false))
		return
	}
	won, beginErr := s.store.BeginAttachmentFetch(r.Context(), row.ID, nowUTC())
	if beginErr != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not start attachment fetch", true))
		return
	}
	if won {
		// The command runs detached: the phone is told to retry, and the result
		// lands in the row before it comes back.
		s.enqueueAttachmentFetch(actor, row)
	}
	writeAttachmentPending(w)
}

// enqueueAttachmentFetch asks the owning Connector to read and upload one file.
func (s *Server) enqueueAttachmentFetch(actor mobileActor, row store.SessionAttachmentRecord) {
	requestID, err := randomToken("req_")
	if err != nil {
		_ = s.store.FailAttachment(context.WithoutCancel(context.Background()), row.ID, protocol.AttachmentErrorFailed, nowUTC())
		return
	}
	s.audit(store.AuditEntry{
		OccurredAt: nowUTC(),
		Actor:      "mobile:" + actor.User.ID,
		Action:     "attachment.fetch",
		RequestID:  requestID,
		DeviceID:   row.DeviceID,
		SessionID:  row.SessionID,
		Result:     "started",
	})
	params := map[string]any{
		"sessionId":    row.SessionID,
		"workspaceId":  row.WorkspaceID,
		"attachmentId": row.ID,
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), attachmentFetchTimeout+5*time.Second)
		defer cancel()
		_, commandError := s.router.Execute(
			ctx,
			protocol.MethodSessionAttachmentFetch,
			row.DeviceID,
			requestID,
			params,
			attachmentFetchTimeout,
		)
		if commandError == nil {
			// The Connector uploads before answering, so the row is already
			// "ready". A success without bytes means it lost the upload.
			current, loadErr := s.store.SessionAttachment(ctx, row.ID)
			if loadErr == nil && current.State != protocol.AttachmentStateReady {
				_ = s.store.FailAttachmentIfFetching(ctx, row.ID, protocol.AttachmentErrorFailed, nowUTC())
			}
			return
		}
		code := commandError.Code
		if !strings.HasPrefix(code, "attachment_") {
			// Transport-level failures stay retryable.
			code = protocol.AttachmentErrorFailed
		}
		_ = s.store.FailAttachmentIfFetching(ctx, row.ID, code, nowUTC())
		s.audit(store.AuditEntry{
			OccurredAt: nowUTC(),
			Actor:      "mobile:" + actor.User.ID,
			Action:     "attachment.fetch",
			RequestID:  requestID,
			DeviceID:   row.DeviceID,
			SessionID:  row.SessionID,
			Result:     "failed",
			ErrorCode:  code,
		})
	}()
}

// serveAttachmentBlob streams stored bytes with digest-based revalidation.
func (s *Server) serveAttachmentBlob(w http.ResponseWriter, r *http.Request, row store.SessionAttachmentRecord) {
	file, err := s.attachmentBlobs.open(row.SHA256)
	if err != nil {
		// Metadata says ready but the bytes are gone: report it as expired so the
		// App can trigger a fresh pull instead of retrying forever.
		_ = s.store.FailAttachment(r.Context(), row.ID, protocol.AttachmentErrorExpired, nowUTC())
		writeAttachmentFailure(w, store.SessionAttachmentRecord{
			ID:        row.ID,
			State:     protocol.AttachmentStateUnavailable,
			ErrorCode: protocol.AttachmentErrorExpired,
		})
		return
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not read attachment", true))
		return
	}
	contentType := row.Mime
	if contentType == "" {
		contentType = sniffMIME(file)
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("ETag", `"`+row.SHA256+`"`)
	if !inlineMIMEs[contentType] {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", row.DisplayName))
	}
	_ = s.store.TouchAttachmentBlob(r.Context(), row.SHA256, nowUTC())
	// ServeContent handles If-None-Match against the ETag above and supports
	// byte ranges for large downloads.
	http.ServeContent(w, r, "", info.ModTime(), file)
}

// handleConnectorAttachmentUpload receives the bytes the Connector read.
//
// The Connector authenticates with its device token, and the row must belong to
// that same device: a Connector cannot fill in another desktop's attachment.
func (s *Server) handleConnectorAttachmentUpload(w http.ResponseWriter, r *http.Request) {
	if !s.attachmentsEnabled() {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "attachments are disabled", false))
		return
	}
	attachmentID := r.PathValue("attachmentId")
	if !attachmentIDPattern.MatchString(attachmentID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "invalid attachmentId", false))
		return
	}
	token, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok || token == "" {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "device token required", false))
		return
	}
	device, err := s.store.AuthenticateDevice(r.Context(), store.HashToken(token), nowUTC())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "device token is invalid", false))
		return
	}
	row, err := s.store.SessionAttachment(r.Context(), attachmentID)
	if err != nil {
		if errors.Is(err, store.ErrAttachmentNotFound) {
			writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "attachment not found", false))
			return
		}
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load attachment", true))
		return
	}
	if row.DeviceID != device.Device.DeviceID {
		writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "attachment belongs to another device", false))
		return
	}
	if header := r.Header.Get("X-DSH-Attachment-Session"); header != row.SessionID {
		writeAPIError(w, protocol.NewError(protocol.CodeConflict, "attachment session does not match", false))
		return
	}
	declaredBytes, parseErr := strconv.ParseInt(r.Header.Get("X-DSH-Attachment-Bytes"), 10, 64)
	if parseErr != nil || declaredBytes < 0 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "X-DSH-Attachment-Bytes is required", false))
		return
	}
	declaredSHA := strings.ToLower(strings.TrimSpace(r.Header.Get("X-DSH-Attachment-Sha256")))
	if len(declaredSHA) != 64 || !isHex(declaredSHA) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "X-DSH-Attachment-Sha256 must be a hex digest", false))
		return
	}
	if declaredBytes > s.config.MaxAttachmentBytes {
		writeAPIError(w, protocol.NewError(protocol.CodePayloadTooLarge, "attachment exceeds the configured size limit", false))
		return
	}
	// Read one byte past the cap so an oversized body is rejected rather than
	// silently truncated into a wrong digest.
	limited := http.MaxBytesReader(w, r.Body, s.config.MaxAttachmentBytes+1)
	data, readErr := io.ReadAll(limited)
	if readErr != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(readErr, &tooLarge) {
			writeAPIError(w, protocol.NewError(protocol.CodePayloadTooLarge, "attachment exceeds the configured size limit", false))
			return
		}
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "could not read request body", false))
		return
	}
	if int64(len(data)) != declaredBytes {
		writeAPIError(w, protocol.NewError(protocol.CodeConflict, "attachment size does not match the declared value", false))
		return
	}
	digest := sha256.Sum256(data)
	actualSHA := hex.EncodeToString(digest[:])
	if actualSHA != declaredSHA {
		writeAPIError(w, protocol.NewError(protocol.CodeConflict, "attachment digest does not match the body", false))
		return
	}
	contentType := row.Mime
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	if err := s.attachmentBlobs.write(actualSHA, data); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not store attachment bytes", true))
		return
	}
	now := nowUTC()
	if err := s.store.PutAttachmentBlob(r.Context(), store.AttachmentBlobRecord{
		SHA256:      actualSHA,
		Mime:        contentType,
		Bytes:       int64(len(data)),
		StoragePath: s.attachmentBlobs.path(actualSHA),
		CreatedAt:   now,
		LastUsedAt:  now,
	}); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not index attachment bytes", true))
		return
	}
	if err := s.store.CompleteAttachment(r.Context(), row.ID, actualSHA, int64(len(data)), now); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not mark attachment ready", true))
		return
	}
	s.broadcastAttachmentReady(row, int64(len(data)), actualSHA)
	s.audit(store.AuditEntry{
		OccurredAt: now,
		Actor:      "connector:" + device.Device.DeviceID,
		Action:     "attachment.ready",
		DeviceID:   row.DeviceID,
		SessionID:  row.SessionID,
		Result:     "success",
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"state":  protocol.AttachmentStateReady,
		"bytes":  len(data),
		"sha256": actualSHA,
	})
}

// broadcastAttachmentReady tells the waiting phone that the bytes arrived, so
// it can reload without polling.
func (s *Server) broadcastAttachmentReady(row store.SessionAttachmentRecord, bytes int64, sha string) {
	payload, err := json.Marshal(map[string]any{
		"attachmentId": row.ID,
		"bytes":        bytes,
		"sha256":       sha,
	})
	if err != nil {
		return
	}
	s.events.Broadcast(protocol.Event{
		V:          protocol.Version,
		Type:       "event",
		EventID:    "evt_" + sha[:16],
		DeviceID:   row.DeviceID,
		SessionID:  row.SessionID,
		Kind:       protocol.EventKindAttachmentReady,
		OccurredAt: nowUTC(),
		Data:       payload,
	})
}

func writeAttachmentPending(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "1")
	writeJSON(w, http.StatusAccepted, map[string]any{
		"state":        protocol.AttachmentStateFetching,
		"retryAfterMs": 800,
	})
}

func writeAttachmentFailure(w http.ResponseWriter, row store.SessionAttachmentRecord) {
	state := row.State
	if state == "" {
		state = protocol.AttachmentStateFailed
	}
	// A desktop verdict is a 409 so the App can explain it; only a blob that
	// expired (or a row with no verdict at all) reads as "gone".
	status := http.StatusConflict
	if row.ErrorCode == "" || row.ErrorCode == protocol.AttachmentErrorExpired {
		status = http.StatusNotFound
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{
		"state":     state,
		"errorCode": row.ErrorCode,
	})
}

func sniffMIME(file *os.File) string {
	head := make([]byte, 512)
	count, err := file.Read(head)
	if err != nil && count == 0 {
		return "application/octet-stream"
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "application/octet-stream"
	}
	return http.DetectContentType(head[:count])
}

func isHex(value string) bool {
	for _, r := range value {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

// attachmentRowTTL keeps the learned metadata longer than the bytes: a phone
// that opens an old session still sees the file and why it is unavailable.
const attachmentRowTTL = 30 * 24 * time.Hour

// learnTranscriptAttachments turns a Connector transcript into durable rows.
//
// The phone never reports attachments and never supplies a path; the Server
// only learns what the desktop declared, which is what makes an unlearned id a
// 404 rather than a probe target. Descriptive fields follow the transcript,
// while state and digest stay Server-owned so a row never regresses from
// "ready" back to "known".
func (s *Server) learnTranscriptAttachments(
	ctx context.Context,
	deviceID, workspaceID, sessionID string,
	messages []protocol.MobileMessage,
) {
	now := nowUTC()
	records := make([]store.SessionAttachmentRecord, 0, 8)
	for index := range messages {
		message := &messages[index]
		for position := range message.Attachments {
			attachment := &message.Attachments[position]
			if !attachmentIDPattern.MatchString(attachment.AttachmentID) {
				continue
			}
			records = append(records, store.SessionAttachmentRecord{
				ID:          attachment.AttachmentID,
				DeviceID:    deviceID,
				SessionID:   sessionID,
				WorkspaceID: workspaceID,
				Source:      attachment.Source,
				SourceSeq:   int64(message.Seq),
				SourceIndex: position,
				Kind:        attachment.Kind,
				DisplayName: attachment.Name,
				Mime:        attachment.Mime,
				Bytes:       attachment.Bytes,
				Description: attachment.Description,
				// The Connector's first verdict decides whether the phone can
				// even try: a file it refused must not look fetchable.
				State:     attachment.State,
				ErrorCode: attachment.ErrorCode,
				ExpiresAt: now.Add(attachmentRowTTL),
			})
		}
	}
	if len(records) == 0 {
		return
	}
	if err := s.store.UpsertSessionAttachments(ctx, records, now); err != nil {
		// A learning failure must not break the transcript: the App still sees
		// the desktop's declaration and can retry on the next refresh.
		log.Printf("learn session attachments device=%s session=%s: %v", deviceID, sessionID, err)
		return
	}
	for index := range messages {
		message := &messages[index]
		for position := range message.Attachments {
			attachment := &message.Attachments[position]
			row, err := s.store.SessionAttachment(ctx, attachment.AttachmentID)
			if err != nil {
				continue
			}
			// Server-owned fields win.
			attachment.State = row.State
			attachment.ErrorCode = row.ErrorCode
			attachment.SHA256 = row.SHA256
			if row.Kind != "" {
				attachment.Kind = row.Kind
			}
			if row.Mime != "" {
				attachment.Mime = row.Mime
			}
			if row.Bytes > 0 {
				attachment.Bytes = row.Bytes
			}
		}
	}
}
