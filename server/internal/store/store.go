// Package store provides the PostgreSQL-backed persistence layer for the
// single-instance DSH Connect Server. It contains no online connection state and
// no DSH session content: session facts always come from the desktop Connector.
package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/deepseek/dsh-connect/server/ent"
	entschema "github.com/deepseek/dsh-connect/server/ent/schema"
	"github.com/deepseek/dsh-connect/server/internal/protocol"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var (
	ErrPairingCodeInvalid      = errors.New("pairing code is invalid")
	ErrPairingCodeUsed         = errors.New("pairing code has already been used")
	ErrPairingCodeExpired      = errors.New("pairing code has expired")
	ErrPairingChallengeInvalid = errors.New("pairing challenge is invalid")
	ErrPairingChallengeExpired = errors.New("pairing challenge has expired")
	ErrPairingAlreadyCompleted = errors.New("pairing has already been completed")
	ErrDeviceNotFound          = errors.New("device not found")
	ErrMobileDeviceNotFound    = errors.New("mobile device not found")
	ErrMobileSessionInvalid    = errors.New("mobile session is invalid or expired")
	ErrMobileGrantNotFound     = errors.New("mobile access grant not found")
	ErrMobileGrantState        = errors.New("mobile access grant is not in the required state")
	ErrUserDisabled            = errors.New("user is disabled")
	ErrIdempotencyExists       = errors.New("idempotency record already exists")
	ErrUserNotFound            = errors.New("user not found")
	ErrUserEmailTaken          = errors.New("user email is already registered")
	ErrSessionInvalid          = errors.New("admin session is invalid or expired")
)

// PairingCode is a one-time desktop pairing code. Only CodeHash is persisted.
type PairingCode struct {
	CodeHash  string     `json:"codeHash"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	UsedAt    *time.Time `json:"usedAt,omitempty"`
	DeviceID  string     `json:"deviceId,omitempty"`
}

// DeviceRecord couples the public device projection with its credential hashes.
type DeviceRecord struct {
	Device           protocol.Device `json:"device"`
	DeviceTokenHash  string          `json:"deviceTokenHash,omitempty"`
	PairingTokenHash string          `json:"pairingTokenHash,omitempty"`
	PairingExpiresAt *time.Time      `json:"pairingExpiresAt,omitempty"`
}

// IdempotencyRecord stores the durable outcome of a session.create, session.prompt or session.model.select request.
type IdempotencyRecord struct {
	RequestID   string          `json:"requestId"`
	Method      string          `json:"method"`
	DeviceID    string          `json:"deviceId"`
	RequestHash string          `json:"requestHash"`
	Result      json.RawMessage `json:"result,omitempty"`
	Error       *protocol.Error `json:"error,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
	CompletedAt time.Time       `json:"completedAt"`
}

// AuditEntry is an append-only record of an administrative or Connector action.
type AuditEntry struct {
	OccurredAt time.Time `json:"occurredAt"`
	Actor      string    `json:"actor"`
	Action     string    `json:"action"`
	RequestID  string    `json:"requestId,omitempty"`
	DeviceID   string    `json:"deviceId,omitempty"`
	SessionID  string    `json:"sessionId,omitempty"`
	Result     string    `json:"result"`
	ErrorCode  string    `json:"errorCode,omitempty"`
	SourceIP   string    `json:"sourceIp,omitempty"`
}

// Store owns the ent client and the underlying database handle.
type Store struct {
	client *ent.Client
	db     *sql.DB
}

// Open connects to PostgreSQL and verifies the connection before returning.
func Open(ctx context.Context, dsn string) (*Store, error) {
	if dsn == "" {
		return nil, errors.New("database URL is required")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	pingContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := db.PingContext(pingContext); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect database: %w", err)
	}
	driver := entsql.OpenDB(dialect.Postgres, db)
	return &Store{client: ent.NewClient(ent.Driver(driver)), db: db}, nil
}

// Client exposes the generated ent client for administrative queries.
func (s *Store) Client() *ent.Client {
	return s.client
}

// Migrate creates missing tables, columns and indexes. It never drops data.
func (s *Store) Migrate(ctx context.Context) error {
	if err := s.client.Schema.Create(ctx); err != nil {
		return fmt.Errorf("migrate schema: %w", err)
	}
	return nil
}

// Close releases the connection pool.
func (s *Store) Close() error {
	if s.client == nil {
		return nil
	}
	return s.client.Close()
}

// HashToken returns the SHA-256 hex digest used to persist secrets.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum[:])
}

func toProtocolWorkspaces(values []entschema.Workspace) []protocol.Workspace {
	result := make([]protocol.Workspace, 0, len(values))
	for _, workspace := range values {
		result = append(result, protocol.Workspace{ID: workspace.ID, Name: workspace.Name, Path: workspace.Path})
	}
	return result
}

func toEntWorkspaces(values []protocol.Workspace) []entschema.Workspace {
	result := make([]entschema.Workspace, 0, len(values))
	for _, workspace := range values {
		result = append(result, entschema.Workspace{ID: workspace.ID, Name: workspace.Name, Path: workspace.Path})
	}
	return result
}

func toDeviceRecord(device *ent.Device) DeviceRecord {
	return DeviceRecord{
		Device: protocol.Device{
			DeviceID:         device.ID,
			DeviceName:       device.DeviceName,
			Fingerprint:      device.Fingerprint,
			ConnectorVersion: device.ConnectorVersion,
			Status:           device.Status,
			Workspaces:       toProtocolWorkspaces(device.Workspaces),
			Scopes:           append([]string(nil), device.Scopes...),
			CreatedAt:        device.CreatedAt,
			UpdatedAt:        device.UpdatedAt,
			LastSeenAt:       device.LastSeenAt,
		},
		DeviceTokenHash:  device.DeviceTokenHash,
		PairingTokenHash: device.PairingTokenHash,
		PairingExpiresAt: device.PairingExpiresAt,
	}
}

func toIdempotencyRecord(record *ent.IdempotencyRecord) IdempotencyRecord {
	result := IdempotencyRecord{
		RequestID:   record.RequestID,
		Method:      record.Method,
		DeviceID:    record.DeviceID,
		RequestHash: record.RequestHash,
		CreatedAt:   record.CreatedAt,
		CompletedAt: record.CompletedAt,
	}
	if record.Result != nil && len(*record.Result) > 0 {
		result.Result = json.RawMessage(*record.Result)
	}
	if record.ErrorCode != "" {
		commandError := protocol.Error{
			Code:      record.ErrorCode,
			Message:   record.ErrorMessage,
			Retryable: record.ErrorRetryable,
		}
		if record.ErrorDetails != nil && len(*record.ErrorDetails) > 0 {
			commandError.Details = json.RawMessage(*record.ErrorDetails)
		}
		result.Error = &commandError
	}
	return result
}

func toAuditEntry(entry *ent.AuditEntry) AuditEntry {
	return AuditEntry{
		OccurredAt: entry.OccurredAt,
		Actor:      entry.Actor,
		Action:     entry.Action,
		RequestID:  entry.RequestID,
		DeviceID:   entry.DeviceID,
		SessionID:  entry.SessionID,
		Result:     entry.Result,
		ErrorCode:  entry.ErrorCode,
		SourceIP:   entry.SourceIP,
	}
}
