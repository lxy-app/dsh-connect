package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"

	"github.com/deepseek/dsh-connect/server/internal/preview"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

// attachmentPreviewCache stores derived PDFs separately from original blobs.
// Its key commits to the original digest and a fixed converter version.
type attachmentPreviewCache struct {
	dir string
}

func (c attachmentPreviewCache) path(key string) string {
	return filepath.Join(c.dir, "previews", key[:2], key+".pdf")
}

func (c attachmentPreviewCache) open(key string) (*os.File, error) {
	return os.Open(c.path(key))
}

// write publishes a complete PDF with an atomic rename, just like original
// attachment blobs. No preview metadata is written to the attachment row or DB.
func (c attachmentPreviewCache) write(key string, data []byte) error {
	target := c.path(key)
	if _, err := os.Stat(target); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".preview-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer func() { _ = os.Remove(name) }()
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(name, target)
}

type attachmentPreviewJob struct {
	done chan struct{}
	err  error
}

// handleMobileAttachmentPreview serves an original PDF or starts an isolated
// Office conversion after the same row-based authorization and fetch lifecycle
// as the original attachment endpoint.
func (s *Server) handleMobileAttachmentPreview(w http.ResponseWriter, r *http.Request) {
	actor, row, ok := s.authorizeMobileAttachment(w, r)
	if !ok {
		return
	}
	isPDF := preview.IsPDF(row.DisplayName, row.Mime)
	extension, isOffice := preview.OfficeExtension(row.DisplayName, row.Mime)
	if !isPDF && !isOffice {
		writeAPIError(w, protocol.NewError(protocol.CodePreviewUnsupported, "attachment format does not support PDF preview", false))
		return
	}
	if !isPDF && isOffice && s.previewClient == nil {
		writeAPIError(w, protocol.NewError(protocol.CodePreviewUnavailable, "Office preview Worker is not configured", false))
		return
	}
	if row.Bytes > s.config.MaxPreviewBytes {
		writeAPIError(w, protocol.NewError(protocol.CodePayloadTooLarge, "attachment exceeds the configured preview size limit", false))
		return
	}
	row, ok = s.ensureAttachmentReady(w, r, actor, row, writePreviewFetching)
	if !ok {
		return
	}
	if isPDF {
		s.serveOriginalPDF(w, r, row)
		return
	}
	s.serveOfficePreview(w, r, row, extension)
}

func attachmentPreviewKey(originalSHA string) string {
	digest := sha256.Sum256([]byte(originalSHA + "\x00" + preview.ConverterVersion))
	return hex.EncodeToString(digest[:])
}

func (s *Server) serveOriginalPDF(w http.ResponseWriter, r *http.Request, row store.SessionAttachmentRecord) {
	file, err := s.attachmentBlobs.open(row.SHA256)
	if err != nil {
		_ = s.store.FailAttachment(r.Context(), row.ID, protocol.AttachmentErrorExpired, nowUTC())
		writeAttachmentFailure(w, store.SessionAttachmentRecord{
			ID: row.ID, State: protocol.AttachmentStateUnavailable, ErrorCode: protocol.AttachmentErrorExpired,
		})
		return
	}
	_ = s.store.TouchAttachmentBlob(r.Context(), row.SHA256, nowUTC())
	serveInlinePDF(w, r, file, row.SHA256)
}

func (s *Server) serveOfficePreview(w http.ResponseWriter, r *http.Request, row store.SessionAttachmentRecord, extension string) {
	key := attachmentPreviewKey(row.SHA256)
	file, err := s.previewCache.open(key)
	if err == nil {
		serveInlinePDF(w, r, file, key)
		return
	}
	if !errors.Is(err, os.ErrNotExist) {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not read cached preview", true))
		return
	}

	s.previewMu.Lock()
	if job, exists := s.previewJobs[key]; exists {
		select {
		case <-job.done:
			if job.err != nil {
				// Surface the failure once. A later explicit request may start a new
				// conversion; no background retry loop is created.
				delete(s.previewJobs, key)
				s.previewMu.Unlock()
				writeAPIError(w, protocol.NewError(protocol.CodePreviewFailed, "Office preview conversion failed", true))
				return
			}
			delete(s.previewJobs, key)
			s.previewMu.Unlock()
			file, err = s.previewCache.open(key)
			if err != nil {
				writeAPIError(w, protocol.NewError(protocol.CodePreviewFailed, "Office preview conversion failed", true))
				return
			}
			serveInlinePDF(w, r, file, key)
			return
		default:
			s.previewMu.Unlock()
			writePreviewConverting(w)
			return
		}
	}
	// A successful job removes itself from the map. Recheck the cache under the
	// flight lock so a request racing that completion cannot start a duplicate.
	file, err = s.previewCache.open(key)
	if err == nil {
		s.previewMu.Unlock()
		serveInlinePDF(w, r, file, key)
		return
	}
	if !errors.Is(err, os.ErrNotExist) {
		s.previewMu.Unlock()
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not read cached preview", true))
		return
	}
	job := &attachmentPreviewJob{done: make(chan struct{})}
	s.previewJobs[key] = job
	s.previewMu.Unlock()
	go s.convertAttachmentPreview(job, key, row.SHA256, extension)
	writePreviewConverting(w)
}

func (s *Server) convertAttachmentPreview(job *attachmentPreviewJob, key, originalSHA, extension string) {
	ctx, cancel := context.WithTimeout(context.Background(), s.config.PreviewTimeout)
	defer cancel()
	source, err := s.attachmentBlobs.open(originalSHA)
	if err == nil {
		var data []byte
		data, err = s.previewClient.Convert(ctx, extension, source)
		_ = source.Close()
		if err == nil {
			err = s.previewCache.write(key, data)
		}
	}
	if err == nil {
		_ = s.store.TouchAttachmentBlob(context.Background(), originalSHA, nowUTC())
	}
	job.err = err
	close(job.done)
	if err == nil {
		s.previewMu.Lock()
		if s.previewJobs[key] == job {
			delete(s.previewJobs, key)
		}
		s.previewMu.Unlock()
	}
}

func serveInlinePDF(w http.ResponseWriter, r *http.Request, file *os.File, etag string) {
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not read PDF preview", true))
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("ETag", `"`+etag+`"`)
	http.ServeContent(w, r, "", info.ModTime(), file)
}

func writePreviewFetching(w http.ResponseWriter) {
	writePreviewPending(w, protocol.AttachmentStateFetching)
}

func writePreviewConverting(w http.ResponseWriter) {
	writePreviewPending(w, "converting")
}

func writePreviewPending(w http.ResponseWriter, state string) {
	w.Header().Set("Retry-After", "1")
	writeJSON(w, http.StatusAccepted, map[string]any{
		"state":        state,
		"retryAfterMs": 1000,
	})
}
