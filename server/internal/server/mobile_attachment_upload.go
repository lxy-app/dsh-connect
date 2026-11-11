package server

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

const (
	// maxMobilePromptAttachments mirrors the App and protocol schema: one prompt
	// carries at most this many attachments.
	maxMobilePromptAttachments = 6
	// maxUploadDisplayName keeps a display name from bloating the row or the
	// Connector payload. It is never interpreted as a path.
	maxUploadDisplayName = 256
)

// uploadImageMIMEs are the image types DSH can admit as a prompt image part.
// Anything else is carried as a plain file part.
var uploadImageMIMEs = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
	"image/gif":  true,
}

// mobileAttachmentRoutes registers the phone-side upload endpoint beside the
// download endpoint. Both live behind the same mobile bearer auth.
func (s *Server) mobileAttachmentRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/mobile/sessions/{sessionId}/attachments", s.mobileAuth(s.handleMobileAttachmentUpload))
	mux.HandleFunc("GET /v1/connector/uploads/{attachmentId}", s.handleConnectorUploadDownload)
}

// handleConnectorUploadDownload hands one staged phone upload to the desktop
// Connector that owns the Session, so it can stage the bytes in DSH and cite a
// receipt instead of trusting a caller-supplied path.
func (s *Server) handleConnectorUploadDownload(w http.ResponseWriter, r *http.Request) {
	if !s.attachmentsEnabled() {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "attachments are disabled", false))
		return
	}
	attachmentID := r.PathValue("attachmentId")
	if !validID(attachmentID) {
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
	if errors.Is(err, store.ErrAttachmentNotFound) {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "attachment not found", false))
		return
	}
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load attachment", true))
		return
	}
	if row.DeviceID != device.Device.DeviceID {
		writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "attachment belongs to another device", false))
		return
	}
	if row.Source != protocol.AttachmentSourceUpload || row.State != protocol.AttachmentStateReady || row.SHA256 == "" {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "attachment is not a staged upload", false))
		return
	}
	file, openErr := s.attachmentBlobs.open(row.SHA256)
	if openErr != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "attachment bytes are gone", false))
		return
	}
	defer func() { _ = file.Close() }()
	info, statErr := file.Stat()
	if statErr != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not read attachment", true))
		return
	}
	w.Header().Set("Content-Type", row.Mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("ETag", `"`+row.SHA256+`"`)
	http.ServeContent(w, r, "", info.ModTime(), file)
}

// handleMobileAttachmentUpload stages bytes the phone picked for one prompt.
//
// The phone sends the raw bytes; the display name and kind travel in headers,
// because the body is not JSON. Nothing is sent to DSH here: the prompt request
// references the returned id, and the Server verifies that the id belongs to the
// same phone, Session and workspace before it is handed to the Connector.
func (s *Server) handleMobileAttachmentUpload(w http.ResponseWriter, r *http.Request) {
	if !s.attachmentsWritable() {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "attachment upload is disabled", false))
		return
	}
	sessionID := r.PathValue("sessionId")
	deviceID := r.URL.Query().Get("deviceId")
	workspaceID := r.URL.Query().Get("workspaceId")
	if !validID(deviceID) || !validID(workspaceID) || !validID(sessionID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "deviceId, workspaceId and sessionId are required", false))
		return
	}
	actor, commandError := s.authorizeMobileSession(r, deviceID, workspaceID, sessionID, "prompt")
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	displayName, nameErr := uploadDisplayName(r)
	if nameErr != nil {
		writeAPIError(w, *nameErr)
		return
	}
	declaredBytes := r.ContentLength
	if declaredBytes <= 0 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "Content-Length is required", false))
		return
	}
	if declaredBytes > s.config.MaxAttachmentBytes {
		writeAPIError(w, protocol.NewError(protocol.CodePayloadTooLarge, "attachment exceeds the configured size limit", false))
		return
	}
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
		writeAPIError(w, protocol.NewError(protocol.CodeConflict, "attachment size does not match Content-Length", false))
		return
	}
	// The declared type is only a hint; the stored type comes from the bytes so
	// a renamed executable cannot claim to be a PNG.
	detected := http.DetectContentType(data)
	if len(data) > 512 {
		detected = http.DetectContentType(data[:512])
	}
	mimeType := detected
	if extension := uploadExtension(displayName); extension != "" {
		// DetectContentType cannot tell Office or PDF-adjacent types apart from
		// generic binary; a matching declared extension fills that in.
		if byExtension := mime.TypeByExtension(extension); byExtension != "" && strings.HasPrefix(detected, "text/") == false && strings.HasPrefix(detected, "image/") == false {
			if !strings.HasPrefix(detected, "application/") || detected == "application/octet-stream" {
				mimeType = strings.Split(byExtension, ";")[0]
			}
		}
	}
	kind := "file"
	if uploadImageMIMEs[mimeType] {
		kind = "image"
	}
	digest := sha256.Sum256(data)
	sha := hex.EncodeToString(digest[:])
	if err := s.attachmentBlobs.write(sha, data); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not store attachment bytes", true))
		return
	}
	now := nowUTC()
	if err := s.store.PutAttachmentBlob(r.Context(), store.AttachmentBlobRecord{
		SHA256:      sha,
		Mime:        mimeType,
		Bytes:       int64(len(data)),
		StoragePath: s.attachmentBlobs.path(sha),
		CreatedAt:   now,
		LastUsedAt:  now,
	}); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not index attachment bytes", true))
		return
	}
	attachmentID, idErr := randomToken("atu_")
	if idErr != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not allocate attachment id", true))
		return
	}
	if err := s.store.CreateUploadedAttachment(r.Context(), store.SessionAttachmentRecord{
		ID:             attachmentID,
		DeviceID:       deviceID,
		MobileDeviceID: actor.Device.Device.MobileDeviceID,
		SessionID:      sessionID,
		WorkspaceID:    workspaceID,
		Source:         protocol.AttachmentSourceUpload,
		Kind:           kind,
		DisplayName:    displayName,
		Mime:           mimeType,
		Bytes:          int64(len(data)),
		SHA256:         sha,
		State:          protocol.AttachmentStateReady,
		ExpiresAt:      now.Add(s.config.AttachmentTTL),
	}, now); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not record attachment", true))
		return
	}
	s.audit(store.AuditEntry{
		OccurredAt: now,
		Actor:      "mobile",
		Action:     "attachment.upload",
		DeviceID:   deviceID,
		SessionID:  sessionID,
		Result:     "success",
	})
	writeJSON(w, http.StatusCreated, protocol.MobileAttachmentUploadResult{
		AttachmentID: attachmentID,
		Kind:         kind,
		Name:         displayName,
		Mime:         mimeType,
		Bytes:        int64(len(data)),
	})
}

// uploadDisplayName resolves the display name from the header, refusing path
// separators so the value can never be mistaken for a desktop path.
func uploadDisplayName(r *http.Request) (string, *protocol.Error) {
	raw := strings.TrimSpace(r.Header.Get("X-DSH-Attachment-Name"))
	if raw == "" {
		return "attachment", nil
	}
	name := raw
	if r.Header.Get("X-DSH-Attachment-Name-Encoding") == "url" {
		decoded, err := url.QueryUnescape(raw)
		if err != nil {
			return "", errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "attachment name is not valid UTF-8 percent encoding", false))
		}
		name = decoded
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return "attachment", nil
	}
	if len(name) > maxUploadDisplayName || strings.ContainsAny(name, "/\\\x00") || name == "." || name == ".." {
		return "", errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "attachment name must be a plain file name", false))
	}
	return name, nil
}

// uploadExtension returns the lowercase extension including the dot.
func uploadExtension(name string) string {
	index := strings.LastIndex(name, ".")
	if index <= 0 || index == len(name)-1 || len(name)-index > 12 {
		return ""
	}
	return strings.ToLower(name[index:])
}

// promptAttachmentParts turns verified upload ids into prompt content parts.
//
// Every id must be an upload this phone staged for the same Session and
// workspace. A desktop-declared attachment id is refused here: it describes a
// file the desktop owns, not bytes the phone submitted.
func (s *Server) promptAttachmentParts(
	r *http.Request,
	mobileDeviceID, deviceID, workspaceID, sessionID string,
	attachments []protocol.MobilePromptAttachment,
) ([]protocol.ContentPart, *protocol.Error) {
	if len(attachments) == 0 {
		return nil, nil
	}
	if len(attachments) > maxMobilePromptAttachments {
		return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "a prompt accepts at most 6 attachments", false))
	}
	parts := make([]protocol.ContentPart, 0, len(attachments))
	seen := make(map[string]bool, len(attachments))
	for _, attachment := range attachments {
		if !validID(attachment.AttachmentID) || seen[attachment.AttachmentID] {
			return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "attachmentId is missing or duplicated", false))
		}
		seen[attachment.AttachmentID] = true
		row, err := s.store.SessionAttachment(r.Context(), attachment.AttachmentID)
		if errors.Is(err, store.ErrAttachmentNotFound) {
			return nil, errorPtr(protocol.NewError(protocol.CodeNotFound, "attachment not found", false))
		}
		if err != nil {
			return nil, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not load attachment", true))
		}
		if row.Source != protocol.AttachmentSourceUpload || row.MobileDeviceID != mobileDeviceID ||
			row.DeviceID != deviceID || row.SessionID != sessionID || row.WorkspaceID != workspaceID {
			return nil, errorPtr(protocol.NewError(protocol.CodeForbidden, "attachment belongs to another session", false))
		}
		if row.State != protocol.AttachmentStateReady || row.SHA256 == "" {
			return nil, errorPtr(protocol.NewError(protocol.CodeConflict, "attachment is not ready yet", true))
		}
		part := protocol.ContentPart{Type: "file", AttachmentID: row.ID, Name: row.DisplayName, Mime: row.Mime}
		if row.Kind == "image" {
			part.Type = "image"
		}
		parts = append(parts, part)
	}
	return parts, nil
}
