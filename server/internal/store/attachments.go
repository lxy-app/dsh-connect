package store

import (
	"context"
	"fmt"
	"time"

	"github.com/deepseek/dsh-connect/server/ent"
	"github.com/deepseek/dsh-connect/server/ent/attachmentblob"
	"github.com/deepseek/dsh-connect/server/ent/sessionattachment"
)

// SessionAttachmentRecord is the persisted projection of one file a DSH Session
// declared for delivery. It deliberately carries no filesystem path: the path
// never leaves the desktop Connector.
type SessionAttachmentRecord struct {
	ID          string
	DeviceID    string
	SessionID   string
	WorkspaceID string
	Source      string
	SourceSeq   int64
	SourceIndex int
	Kind        string
	DisplayName string
	Mime        string
	Bytes       int64
	SHA256      string
	Description string
	State       string
	ErrorCode   string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ExpiresAt   time.Time
}

// AttachmentBlobRecord indexes one content-addressed blob under the attachment
// directory.
type AttachmentBlobRecord struct {
	SHA256      string
	Mime        string
	Bytes       int64
	StoragePath string
	CreatedAt   time.Time
	LastUsedAt  time.Time
}

var (
	// ErrAttachmentNotFound means the Server never learned this attachment id
	// from a transcript, so it must be refused rather than probed.
	ErrAttachmentNotFound = fmt.Errorf("session attachment not found")
	// ErrAttachmentState means the row is not in a state that allows the
	// requested transition.
	ErrAttachmentState = fmt.Errorf("session attachment is not in the required state")
)

// UpsertSessionAttachments learns attachment metadata from a Connector
// transcript. It refreshes descriptive fields but never downgrades a row the
// Server already advanced: state, digest and error code stay server-owned.
func (s *Store) UpsertSessionAttachments(ctx context.Context, records []SessionAttachmentRecord, now time.Time) error {
	for _, record := range records {
		existing, err := s.client.SessionAttachment.Get(ctx, record.ID)
		switch {
		case ent.IsNotFound(err):
			_, createErr := s.client.SessionAttachment.Create().
				SetID(record.ID).
				SetDeviceID(record.DeviceID).
				SetSessionID(record.SessionID).
				SetWorkspaceID(record.WorkspaceID).
				SetSource(sessionattachment.Source(record.Source)).
				SetSourceSeq(record.SourceSeq).
				SetSourceIndex(record.SourceIndex).
				SetKind(sessionattachment.Kind(record.Kind)).
				SetDisplayName(record.DisplayName).
				SetMime(record.Mime).
				SetBytes(record.Bytes).
				SetNillableDescription(nilIfEmpty(record.Description)).
				SetState(sessionattachment.StateKnown).
				SetCreatedAt(now).
				SetUpdatedAt(now).
				SetExpiresAt(record.ExpiresAt).
				Save(ctx)
			if createErr != nil {
				return fmt.Errorf("create session attachment %s: %w", record.ID, createErr)
			}
		case err != nil:
			return fmt.Errorf("load session attachment %s: %w", record.ID, err)
		default:
			if _, updateErr := s.client.SessionAttachment.UpdateOneID(existing.ID).
				SetDeviceID(record.DeviceID).
				SetSessionID(record.SessionID).
				SetWorkspaceID(record.WorkspaceID).
				SetSource(sessionattachment.Source(record.Source)).
				SetSourceSeq(record.SourceSeq).
				SetSourceIndex(record.SourceIndex).
				SetKind(sessionattachment.Kind(record.Kind)).
				SetDisplayName(record.DisplayName).
				SetMime(record.Mime).
				SetBytes(record.Bytes).
				SetNillableDescription(nilIfEmpty(record.Description)).
				SetUpdatedAt(now).
				SetExpiresAt(record.ExpiresAt).
				Save(ctx); updateErr != nil {
				return fmt.Errorf("update session attachment %s: %w", record.ID, updateErr)
			}
		}
	}
	return nil
}

// SessionAttachment returns one learned attachment row by opaque id.
func (s *Store) SessionAttachment(ctx context.Context, id string) (SessionAttachmentRecord, error) {
	entity, err := s.client.SessionAttachment.Get(ctx, id)
	if ent.IsNotFound(err) {
		return SessionAttachmentRecord{}, ErrAttachmentNotFound
	}
	if err != nil {
		return SessionAttachmentRecord{}, fmt.Errorf("load session attachment %s: %w", id, err)
	}
	return attachmentRecordFromEnt(entity), nil
}

// BeginAttachmentFetch atomically moves a row into "fetching" so concurrent
// requests enqueue one Connector command. It reports whether this caller won.
func (s *Store) BeginAttachmentFetch(ctx context.Context, id string, now time.Time) (bool, error) {
	updated, err := s.client.SessionAttachment.Update().
		Where(
			sessionattachment.IDEQ(id),
			sessionattachment.StateIn(
				sessionattachment.StateKnown,
				sessionattachment.StateFailed,
				sessionattachment.StateUnavailable,
			),
		).
		SetState(sessionattachment.StateFetching).
		ClearErrorCode().
		SetUpdatedAt(now).
		Save(ctx)
	if err != nil {
		return false, fmt.Errorf("begin attachment fetch %s: %w", id, err)
	}
	return updated == 1, nil
}

// CompleteAttachment records a successful upload.
func (s *Store) CompleteAttachment(ctx context.Context, id, sha256 string, bytes int64, now time.Time) error {
	updated, err := s.client.SessionAttachment.Update().
		Where(sessionattachment.IDEQ(id)).
		SetState(sessionattachment.StateReady).
		SetSha256(sha256).
		SetBytes(bytes).
		ClearErrorCode().
		SetUpdatedAt(now).
		Save(ctx)
	if err != nil {
		return fmt.Errorf("complete attachment %s: %w", id, err)
	}
	if updated != 1 {
		return ErrAttachmentNotFound
	}
	return nil
}

// FailAttachment stores a stable error code so the App can explain the failure.
func (s *Store) FailAttachment(ctx context.Context, id, code string, now time.Time) error {
	updated, err := s.client.SessionAttachment.Update().
		Where(sessionattachment.IDEQ(id)).
		SetState(sessionattachment.StateFailed).
		SetErrorCode(code).
		SetUpdatedAt(now).
		Save(ctx)
	if err != nil {
		return fmt.Errorf("fail attachment %s: %w", id, err)
	}
	if updated != 1 {
		return ErrAttachmentNotFound
	}
	return nil
}

// PutAttachmentBlob records a content-addressed blob. The bytes themselves are
// written by the caller; this row is the durable index.
func (s *Store) PutAttachmentBlob(ctx context.Context, record AttachmentBlobRecord) error {
	existing, err := s.client.AttachmentBlob.Get(ctx, record.SHA256)
	switch {
	case ent.IsNotFound(err):
		_, createErr := s.client.AttachmentBlob.Create().
			SetID(record.SHA256).
			SetMime(record.Mime).
			SetBytes(record.Bytes).
			SetStoragePath(record.StoragePath).
			SetCreatedAt(record.CreatedAt).
			SetLastUsedAt(record.LastUsedAt).
			Save(ctx)
		if createErr != nil {
			return fmt.Errorf("create attachment blob %s: %w", record.SHA256, createErr)
		}
		return nil
	case err != nil:
		return fmt.Errorf("load attachment blob %s: %w", record.SHA256, err)
	default:
		if _, updateErr := s.client.AttachmentBlob.UpdateOneID(existing.ID).
			SetLastUsedAt(record.LastUsedAt).
			Save(ctx); updateErr != nil {
			return fmt.Errorf("touch attachment blob %s: %w", record.SHA256, updateErr)
		}
		return nil
	}
}

// AttachmentBlob returns one blob index row.
func (s *Store) AttachmentBlob(ctx context.Context, sha256 string) (AttachmentBlobRecord, error) {
	entity, err := s.client.AttachmentBlob.Get(ctx, sha256)
	if ent.IsNotFound(err) {
		return AttachmentBlobRecord{}, ErrAttachmentNotFound
	}
	if err != nil {
		return AttachmentBlobRecord{}, fmt.Errorf("load attachment blob %s: %w", sha256, err)
	}
	return AttachmentBlobRecord{
		SHA256:      entity.ID,
		Mime:        entity.Mime,
		Bytes:       entity.Bytes,
		StoragePath: entity.StoragePath,
		CreatedAt:   entity.CreatedAt,
		LastUsedAt:  entity.LastUsedAt,
	}, nil
}

// TouchAttachmentBlob refreshes the retention timestamp after a successful read.
func (s *Store) TouchAttachmentBlob(ctx context.Context, sha256 string, now time.Time) error {
	_, err := s.client.AttachmentBlob.Update().
		Where(attachmentblob.IDEQ(sha256)).
		SetLastUsedAt(now).
		Save(ctx)
	if err != nil {
		return fmt.Errorf("touch attachment blob %s: %w", sha256, err)
	}
	return nil
}

func attachmentRecordFromEnt(entity *ent.SessionAttachment) SessionAttachmentRecord {
	return SessionAttachmentRecord{
		ID:          entity.ID,
		DeviceID:    entity.DeviceID,
		SessionID:   entity.SessionID,
		WorkspaceID: entity.WorkspaceID,
		Source:      string(entity.Source),
		SourceSeq:   entity.SourceSeq,
		SourceIndex: entity.SourceIndex,
		Kind:        string(entity.Kind),
		DisplayName: entity.DisplayName,
		Mime:        entity.Mime,
		Bytes:       entity.Bytes,
		SHA256:      entity.Sha256,
		Description: entity.Description,
		State:       string(entity.State),
		ErrorCode:   entity.ErrorCode,
		CreatedAt:   entity.CreatedAt,
		UpdatedAt:   entity.UpdatedAt,
		ExpiresAt:   entity.ExpiresAt,
	}
}

func nilIfEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}