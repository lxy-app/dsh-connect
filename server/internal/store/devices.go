package store

import (
	"context"
	"crypto/subtle"
	"fmt"
	"time"

	"github.com/deepseek/dsh-connect/server/ent"
	"github.com/deepseek/dsh-connect/server/ent/device"
	"github.com/deepseek/dsh-connect/server/ent/pairingcode"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
)

// CreatePairingCode inserts a new one-time pairing code hash.
func (s *Store) CreatePairingCode(ctx context.Context, code PairingCode) error {
	builder := s.client.PairingCode.Create().
		SetCodeHash(code.CodeHash).
		SetCreatedAt(code.CreatedAt).
		SetExpiresAt(code.ExpiresAt)
	if code.DeviceID != "" {
		builder.SetDeviceID(code.DeviceID)
	}
	if _, err := builder.Save(ctx); err != nil {
		return fmt.Errorf("create pairing code: %w", err)
	}
	return nil
}

// PairingCodeRecord exposes pairing code metadata for administrative listing.
// The plaintext code is never recoverable: only its hash is stored.
type PairingCodeRecord struct {
	CreatedAt time.Time
	ExpiresAt time.Time
	UsedAt    *time.Time
	DeviceID  string
}

// PairingCodes lists the most recent pairing codes, newest first.
func (s *Store) PairingCodes(ctx context.Context, limit int) ([]PairingCodeRecord, error) {
	if limit <= 0 || limit > 200 {
		limit = 20
	}
	records, err := s.client.PairingCode.Query().
		Order(ent.Desc(pairingcode.FieldCreatedAt)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list pairing codes: %w", err)
	}
	result := make([]PairingCodeRecord, 0, len(records))
	for _, record := range records {
		result = append(result, PairingCodeRecord{
			CreatedAt: record.CreatedAt,
			ExpiresAt: record.ExpiresAt,
			UsedAt:    record.UsedAt,
			DeviceID:  record.DeviceID,
		})
	}
	return result, nil
}

// BeginPairing atomically consumes a pairing code and registers a device that
// is still waiting for explicit desktop authorization.
func (s *Store) BeginPairing(ctx context.Context, codeHash string, record DeviceRecord) error {
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return fmt.Errorf("begin pairing transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	code, err := tx.PairingCode.Query().
		Where(pairingcode.CodeHash(codeHash)).
		Only(ctx)
	if ent.IsNotFound(err) {
		return ErrPairingCodeInvalid
	}
	if err != nil {
		return fmt.Errorf("load pairing code: %w", err)
	}
	if code.UsedAt != nil {
		return ErrPairingCodeUsed
	}
	now := record.Device.CreatedAt
	if !now.Before(code.ExpiresAt) {
		return ErrPairingCodeExpired
	}
	exists, err := tx.Device.Query().Where(device.IDEQ(record.Device.DeviceID)).Exist(ctx)
	if err != nil {
		return fmt.Errorf("check device identity: %w", err)
	}
	if exists {
		return fmt.Errorf("device id collision")
	}

	deviceBuilder := tx.Device.Create().
		SetID(record.Device.DeviceID).
		SetDeviceName(record.Device.DeviceName).
		SetFingerprint(record.Device.Fingerprint).
		SetConnectorVersion(record.Device.ConnectorVersion).
		SetStatus(record.Device.Status).
		SetWorkspaces(toEntWorkspaces(record.Device.Workspaces)).
		SetScopes(append([]string(nil), record.Device.Scopes...)).
		SetCreatedAt(record.Device.CreatedAt).
		SetUpdatedAt(record.Device.UpdatedAt)
	if record.PairingTokenHash != "" {
		deviceBuilder.SetPairingTokenHash(record.PairingTokenHash)
	}
	if record.PairingExpiresAt != nil {
		deviceBuilder.SetPairingExpiresAt(*record.PairingExpiresAt)
	}
	if err := deviceBuilder.Exec(ctx); err != nil {
		return fmt.Errorf("create device: %w", err)
	}

	// The conditional update guarantees a code is consumed exactly once even if
	// two Connectors race on the same code.
	updated, err := tx.PairingCode.Update().
		Where(pairingcode.ID(code.ID), pairingcode.UsedAtIsNil()).
		SetUsedAt(now).
		SetDeviceID(record.Device.DeviceID).
		Save(ctx)
	if err != nil {
		return fmt.Errorf("consume pairing code: %w", err)
	}
	if updated == 0 {
		return ErrPairingCodeUsed
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit pairing transaction: %w", err)
	}
	return nil
}

// AuthorizePairing completes the desktop-side authorization and stores the
// long-lived device token hash.
func (s *Store) AuthorizePairing(ctx context.Context, deviceID, pairingTokenHash, deviceTokenHash string, workspaces []protocol.Workspace, scopes []string, now time.Time) (DeviceRecord, error) {
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return DeviceRecord{}, fmt.Errorf("begin authorize transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	record, err := tx.Device.Query().Where(device.IDEQ(deviceID)).Only(ctx)
	if ent.IsNotFound(err) {
		return DeviceRecord{}, ErrDeviceNotFound
	}
	if err != nil {
		return DeviceRecord{}, fmt.Errorf("load device: %w", err)
	}
	if record.Status != "waiting_desktop_authorization" {
		return DeviceRecord{}, ErrPairingAlreadyCompleted
	}
	if record.PairingExpiresAt == nil || !now.Before(*record.PairingExpiresAt) {
		return DeviceRecord{}, ErrPairingChallengeExpired
	}
	if record.PairingTokenHash == "" || subtle.ConstantTimeCompare([]byte(record.PairingTokenHash), []byte(pairingTokenHash)) != 1 {
		return DeviceRecord{}, ErrPairingChallengeInvalid
	}

	updated, err := tx.Device.Update().
		Where(device.IDEQ(deviceID), device.StatusEQ("waiting_desktop_authorization")).
		SetDeviceTokenHash(deviceTokenHash).
		SetPairingTokenHash("").
		ClearPairingExpiresAt().
		SetWorkspaces(toEntWorkspaces(workspaces)).
		SetScopes(append([]string(nil), scopes...)).
		SetStatus("online").
		SetUpdatedAt(now).
		SetLastSeenAt(now).
		Save(ctx)
	if err != nil {
		return DeviceRecord{}, fmt.Errorf("authorize device: %w", err)
	}
	if updated == 0 {
		return DeviceRecord{}, ErrPairingAlreadyCompleted
	}
	persisted, err := tx.Device.Query().Where(device.IDEQ(deviceID)).Only(ctx)
	if err != nil {
		return DeviceRecord{}, fmt.Errorf("reload authorized device: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return DeviceRecord{}, fmt.Errorf("commit authorize transaction: %w", err)
	}
	return toDeviceRecord(persisted), nil
}

// UpdateDeviceGrants replaces one device's authorized workspaces and scopes.
// The Connector is the authority for its own grants; the caller has already
// validated the vocabulary and confirmed the change on the desktop.
func (s *Store) UpdateDeviceGrants(ctx context.Context, deviceID string, workspaces []protocol.Workspace, scopes []string, now time.Time) (DeviceRecord, error) {
	updated, err := s.client.Device.Update().
		Where(device.IDEQ(deviceID)).
		SetWorkspaces(toEntWorkspaces(workspaces)).
		SetScopes(append([]string(nil), scopes...)).
		SetUpdatedAt(now).
		Save(ctx)
	if err != nil {
		return DeviceRecord{}, fmt.Errorf("update device grants: %w", err)
	}
	if updated == 0 {
		return DeviceRecord{}, ErrDeviceNotFound
	}
	record, err := s.Device(ctx, deviceID)
	if err != nil {
		return DeviceRecord{}, err
	}
	return record, nil
}

// AuthenticateDevice resolves a device token hash to a device and marks it
// online. The comparison is constant-time against the stored hash.
func (s *Store) AuthenticateDevice(ctx context.Context, tokenHash string, now time.Time) (DeviceRecord, error) {
	candidates, err := s.client.Device.Query().
		Where(
			device.DeviceTokenHashNEQ(""),
			device.StatusNEQ("waiting_desktop_authorization"),
		).
		All(ctx)
	if err != nil {
		return DeviceRecord{}, fmt.Errorf("load device candidates: %w", err)
	}
	var matched *ent.Device
	for _, candidate := range candidates {
		if subtle.ConstantTimeCompare([]byte(candidate.DeviceTokenHash), []byte(tokenHash)) == 1 {
			matched = candidate
			break
		}
	}
	if matched == nil {
		return DeviceRecord{}, ErrDeviceNotFound
	}
	if _, err := s.client.Device.Update().
		Where(device.IDEQ(matched.ID)).
		SetStatus("online").
		SetUpdatedAt(now).
		SetLastSeenAt(now).
		Save(ctx); err != nil {
		return DeviceRecord{}, fmt.Errorf("mark device online: %w", err)
	}
	record, err := s.client.Device.Query().Where(device.IDEQ(matched.ID)).Only(ctx)
	if err != nil {
		return DeviceRecord{}, fmt.Errorf("reload authenticated device: %w", err)
	}
	return toDeviceRecord(record), nil
}

// SetDeviceStatus updates the presence status of a device.
func (s *Store) SetDeviceStatus(ctx context.Context, deviceID, status string, now time.Time) error {
	builder := s.client.Device.Update().
		Where(device.IDEQ(deviceID)).
		SetStatus(status).
		SetUpdatedAt(now)
	if status == "online" {
		builder.SetLastSeenAt(now)
	}
	updated, err := builder.Save(ctx)
	if err != nil {
		return fmt.Errorf("update device status: %w", err)
	}
	if updated == 0 {
		return ErrDeviceNotFound
	}
	return nil
}

// CreateDevice inserts a device record directly. It exists for tests and
// administrative seeding; the pairing flow must use BeginPairing instead.
func (s *Store) CreateDevice(ctx context.Context, record DeviceRecord) error {
	builder := s.client.Device.Create().
		SetID(record.Device.DeviceID).
		SetDeviceName(record.Device.DeviceName).
		SetFingerprint(record.Device.Fingerprint).
		SetConnectorVersion(record.Device.ConnectorVersion).
		SetStatus(record.Device.Status).
		SetWorkspaces(toEntWorkspaces(record.Device.Workspaces)).
		SetScopes(append([]string(nil), record.Device.Scopes...)).
		SetCreatedAt(record.Device.CreatedAt).
		SetUpdatedAt(record.Device.UpdatedAt)
	if record.DeviceTokenHash != "" {
		builder.SetDeviceTokenHash(record.DeviceTokenHash)
	}
	if record.PairingTokenHash != "" {
		builder.SetPairingTokenHash(record.PairingTokenHash)
	}
	if record.PairingExpiresAt != nil {
		builder.SetPairingExpiresAt(*record.PairingExpiresAt)
	}
	if record.Device.LastSeenAt != nil {
		builder.SetLastSeenAt(*record.Device.LastSeenAt)
	}
	if err := builder.Exec(ctx); err != nil {
		return fmt.Errorf("create device: %w", err)
	}
	return nil
}

// Device loads a single device by public id.
func (s *Store) Device(ctx context.Context, deviceID string) (DeviceRecord, error) {
	record, err := s.client.Device.Query().Where(device.IDEQ(deviceID)).Only(ctx)
	if ent.IsNotFound(err) {
		return DeviceRecord{}, ErrDeviceNotFound
	}
	if err != nil {
		return DeviceRecord{}, fmt.Errorf("load device: %w", err)
	}
	return toDeviceRecord(record), nil
}

// Devices lists every device ordered by public id.
func (s *Store) Devices(ctx context.Context) ([]DeviceRecord, error) {
	records, err := s.client.Device.Query().Order(ent.Asc(device.FieldID)).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	result := make([]DeviceRecord, 0, len(records))
	for _, record := range records {
		result = append(result, toDeviceRecord(record))
	}
	return result, nil
}

// RenameDevice updates the human-readable device name.
func (s *Store) RenameDevice(ctx context.Context, deviceID, name string, now time.Time) error {
	updated, err := s.client.Device.Update().
		Where(device.IDEQ(deviceID)).
		SetDeviceName(name).
		SetUpdatedAt(now).
		Save(ctx)
	if err != nil {
		return fmt.Errorf("rename device: %w", err)
	}
	if updated == 0 {
		return ErrDeviceNotFound
	}
	return nil
}

// RevokeDevice clears the device credential so the Connector cannot reconnect.
// The row is kept for audit and history.
func (s *Store) RevokeDevice(ctx context.Context, deviceID string, now time.Time) error {
	updated, err := s.client.Device.Update().
		Where(device.IDEQ(deviceID)).
		SetDeviceTokenHash("").
		SetPairingTokenHash("").
		ClearPairingExpiresAt().
		SetStatus("revoked").
		SetUpdatedAt(now).
		Save(ctx)
	if err != nil {
		return fmt.Errorf("revoke device: %w", err)
	}
	if updated == 0 {
		return ErrDeviceNotFound
	}
	return nil
}

// DeleteDevice removes a device row entirely.
func (s *Store) DeleteDevice(ctx context.Context, deviceID string) error {
	affected, err := s.client.Device.Delete().Where(device.IDEQ(deviceID)).Exec(ctx)
	if err != nil {
		return fmt.Errorf("delete device: %w", err)
	}
	if affected == 0 {
		return ErrDeviceNotFound
	}
	return nil
}

// MarkDeviceOffline records a disconnected Connector without resurrecting a
// revoked device: revocation is a terminal administrative state.
func (s *Store) MarkDeviceOffline(ctx context.Context, deviceID string, now time.Time) error {
	if _, err := s.client.Device.Update().
		Where(
			device.IDEQ(deviceID),
			device.StatusNEQ("revoked"),
		).
		SetStatus("offline").
		SetUpdatedAt(now).
		Save(ctx); err != nil {
		return fmt.Errorf("mark device offline: %w", err)
	}
	return nil
}

// SetAllOffline clears stale presence on startup: no Connector is connected yet.
func (s *Store) SetAllOffline(ctx context.Context, now time.Time) error {
	if _, err := s.client.Device.Update().
		Where(device.StatusEQ("online")).
		SetStatus("offline").
		SetUpdatedAt(now).
		Save(ctx); err != nil {
		return fmt.Errorf("reset device presence: %w", err)
	}
	return nil
}
