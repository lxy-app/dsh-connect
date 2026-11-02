package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/deepseek/dsh-connect/server/ent"
	"github.com/deepseek/dsh-connect/server/ent/auditentry"
	"github.com/deepseek/dsh-connect/server/ent/idempotencyrecord"
)

// Idempotency loads a durable command outcome by request id.
func (s *Store) Idempotency(ctx context.Context, requestID string) (IdempotencyRecord, bool, error) {
	record, err := s.client.IdempotencyRecord.Query().
		Where(idempotencyrecord.RequestID(requestID)).
		Only(ctx)
	if ent.IsNotFound(err) {
		return IdempotencyRecord{}, false, nil
	}
	if err != nil {
		return IdempotencyRecord{}, false, fmt.Errorf("load idempotency record: %w", err)
	}
	return toIdempotencyRecord(record), true, nil
}

// CompleteIdempotency persists the outcome of a command. A concurrent duplicate
// returns ErrIdempotencyExists so the caller keeps the first result.
func (s *Store) CompleteIdempotency(ctx context.Context, record IdempotencyRecord) error {
	builder := s.client.IdempotencyRecord.Create().
		SetRequestID(record.RequestID).
		SetMethod(record.Method).
		SetDeviceID(record.DeviceID).
		SetRequestHash(record.RequestHash).
		SetCreatedAt(record.CreatedAt).
		SetCompletedAt(record.CompletedAt)
	if len(record.Result) > 0 {
		builder.SetResult([]byte(record.Result))
	}
	if record.Error != nil {
		builder.
			SetErrorCode(record.Error.Code).
			SetErrorMessage(record.Error.Message).
			SetErrorRetryable(record.Error.Retryable)
		if len(record.Error.Details) > 0 {
			builder.SetErrorDetails([]byte(record.Error.Details))
		}
	}
	if err := builder.Exec(ctx); err != nil {
		if ent.IsConstraintError(err) {
			return ErrIdempotencyExists
		}
		return fmt.Errorf("persist idempotency record: %w", err)
	}
	return nil
}

// AppendAudit stores one append-only audit entry.
func (s *Store) AppendAudit(ctx context.Context, entry AuditEntry) error {
	builder := s.client.AuditEntry.Create().
		SetOccurredAt(entry.OccurredAt).
		SetActor(entry.Actor).
		SetAction(entry.Action).
		SetResult(entry.Result)
	if entry.RequestID != "" {
		builder.SetRequestID(entry.RequestID)
	}
	if entry.DeviceID != "" {
		builder.SetDeviceID(entry.DeviceID)
	}
	if entry.SessionID != "" {
		builder.SetSessionID(entry.SessionID)
	}
	if entry.ErrorCode != "" {
		builder.SetErrorCode(entry.ErrorCode)
	}
	if entry.SourceIP != "" {
		builder.SetSourceIP(entry.SourceIP)
	}
	if err := builder.Exec(ctx); err != nil {
		return fmt.Errorf("append audit entry: %w", err)
	}
	return nil
}

// AuditQuery narrows an audit listing.
type AuditQuery struct {
	Actor    string
	Action   string
	DeviceID string
	Result   string
	From     *time.Time
	To       *time.Time
	Limit    int
	Offset   int
}

// Audit returns newest-first audit entries plus the total matching count.
func (s *Store) Audit(ctx context.Context, query AuditQuery) ([]AuditEntry, int, error) {
	builder := s.client.AuditEntry.Query()
	if query.Actor != "" {
		builder.Where(auditentry.ActorEQ(query.Actor))
	}
	if query.Action != "" {
		builder.Where(auditentry.ActionEQ(query.Action))
	}
	if query.DeviceID != "" {
		builder.Where(auditentry.DeviceIDEQ(query.DeviceID))
	}
	if query.Result != "" {
		builder.Where(auditentry.ResultEQ(query.Result))
	}
	if query.From != nil {
		builder.Where(auditentry.OccurredAtGTE(*query.From))
	}
	if query.To != nil {
		builder.Where(auditentry.OccurredAtLT(*query.To))
	}
	total, err := builder.Clone().Count(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("count audit entries: %w", err)
	}
	limit := query.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	offset := query.Offset
	if offset < 0 {
		offset = 0
	}
	records, err := builder.
		Order(ent.Desc(auditentry.FieldOccurredAt), ent.Desc(auditentry.FieldID)).
		Limit(limit).
		Offset(offset).
		All(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("list audit entries: %w", err)
	}
	entries := make([]AuditEntry, 0, len(records))
	for _, record := range records {
		entries = append(entries, toAuditEntry(record))
	}
	return entries, total, nil
}

// ErrAuditNotFound is retained for symmetry with other lookups.
var ErrAuditNotFound = errors.New("audit entry not found")
