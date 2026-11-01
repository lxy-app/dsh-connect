package store

import (
	"context"
	"fmt"
	"time"

	"github.com/deepseek/dsh-connect/server/ent"
	"github.com/deepseek/dsh-connect/server/ent/mobileaccessgrant"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
)

// MobileAccessGrantRecord is the persisted desktop decision for one phone. A
// phone pairing alone has no grant; the row starts as pending and becomes
// active only after the desktop user approves it.
type MobileAccessGrantRecord struct {
	ID             string
	MobileDeviceID string
	DeviceID       string
	UserID         string
	Workspaces     []protocol.Workspace
	Scopes         []string
	Status         string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	DecidedAt      *time.Time
}

// RequestMobileAccess creates or refreshes a pending grant. An already active
// grant is never downgraded by a repeated request.
func (s *Store) RequestMobileAccess(ctx context.Context, record MobileAccessGrantRecord, now time.Time) (MobileAccessGrantRecord, error) {
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return MobileAccessGrantRecord{}, fmt.Errorf("begin mobile access request transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	existing, err := tx.MobileAccessGrant.Query().
		Where(
			mobileaccessgrant.MobileDeviceID(record.MobileDeviceID),
			mobileaccessgrant.DeviceID(record.DeviceID),
		).
		Only(ctx)
	switch {
	case ent.IsNotFound(err):
		created, createErr := tx.MobileAccessGrant.Create().
			SetID(record.ID).
			SetMobileDeviceID(record.MobileDeviceID).
			SetDeviceID(record.DeviceID).
			SetUserID(record.UserID).
			SetWorkspaces(toEntWorkspaces(record.Workspaces)).
			SetScopes(append([]string(nil), record.Scopes...)).
			SetStatus(mobileaccessgrant.StatusPending).
			SetCreatedAt(now).
			SetUpdatedAt(now).
			Save(ctx)
		if createErr != nil {
			return MobileAccessGrantRecord{}, fmt.Errorf("create mobile access request: %w", createErr)
		}
		if err := tx.Commit(); err != nil {
			return MobileAccessGrantRecord{}, fmt.Errorf("commit mobile access request: %w", err)
		}
		return toMobileAccessGrantRecord(created), nil
	case err != nil:
		return MobileAccessGrantRecord{}, fmt.Errorf("load mobile access request: %w", err)
	}

	if existing.Status == mobileaccessgrant.StatusActive {
		persisted := toMobileAccessGrantRecord(existing)
		if err := tx.Commit(); err != nil {
			return MobileAccessGrantRecord{}, fmt.Errorf("commit active mobile access request: %w", err)
		}
		return persisted, nil
	}

	if _, err := tx.MobileAccessGrant.Update().
		Where(mobileaccessgrant.IDEQ(existing.ID)).
		SetWorkspaces(toEntWorkspaces(record.Workspaces)).
		SetScopes(append([]string(nil), record.Scopes...)).
		SetStatus(mobileaccessgrant.StatusPending).
		ClearDecidedAt().
		SetUpdatedAt(now).
		Save(ctx); err != nil {
		return MobileAccessGrantRecord{}, fmt.Errorf("refresh mobile access request: %w", err)
	}
	persisted, err := tx.MobileAccessGrant.Query().Where(mobileaccessgrant.IDEQ(existing.ID)).Only(ctx)
	if err != nil {
		return MobileAccessGrantRecord{}, fmt.Errorf("reload mobile access request: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return MobileAccessGrantRecord{}, fmt.Errorf("commit mobile access request: %w", err)
	}
	return toMobileAccessGrantRecord(persisted), nil
}

// MobileAccessGrantsForMobile lists every desktop decision for one phone.
func (s *Store) MobileAccessGrantsForMobile(ctx context.Context, mobileDeviceID string) ([]MobileAccessGrantRecord, error) {
	records, err := s.client.MobileAccessGrant.Query().
		Where(mobileaccessgrant.MobileDeviceID(mobileDeviceID)).
		Order(ent.Asc(mobileaccessgrant.FieldDeviceID)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list mobile access grants: %w", err)
	}
	return toMobileAccessGrantRecords(records), nil
}

// MobileAccessGrantsForDevice lists every phone decision for one desktop.
func (s *Store) MobileAccessGrantsForDevice(ctx context.Context, deviceID string) ([]MobileAccessGrantRecord, error) {
	records, err := s.client.MobileAccessGrant.Query().
		Where(
			mobileaccessgrant.DeviceID(deviceID),
			mobileaccessgrant.StatusIn(mobileaccessgrant.StatusPending, mobileaccessgrant.StatusActive),
		).
		Order(ent.Asc(mobileaccessgrant.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list desktop mobile access grants: %w", err)
	}
	return toMobileAccessGrantRecords(records), nil
}

// MobileAccessGrant loads one grant for a phone/desktop pair.
func (s *Store) MobileAccessGrant(ctx context.Context, mobileDeviceID, deviceID string) (MobileAccessGrantRecord, error) {
	record, err := s.client.MobileAccessGrant.Query().
		Where(
			mobileaccessgrant.MobileDeviceID(mobileDeviceID),
			mobileaccessgrant.DeviceID(deviceID),
		).
		Only(ctx)
	if ent.IsNotFound(err) {
		return MobileAccessGrantRecord{}, ErrMobileGrantNotFound
	}
	if err != nil {
		return MobileAccessGrantRecord{}, fmt.Errorf("load mobile access grant: %w", err)
	}
	return toMobileAccessGrantRecord(record), nil
}

// MobileAccessGrantByID loads one grant by its public id.
func (s *Store) MobileAccessGrantByID(ctx context.Context, grantID string) (MobileAccessGrantRecord, error) {
	record, err := s.client.MobileAccessGrant.Query().
		Where(mobileaccessgrant.IDEQ(grantID)).
		Only(ctx)
	if ent.IsNotFound(err) {
		return MobileAccessGrantRecord{}, ErrMobileGrantNotFound
	}
	if err != nil {
		return MobileAccessGrantRecord{}, fmt.Errorf("load mobile access grant: %w", err)
	}
	return toMobileAccessGrantRecord(record), nil
}

// DecideMobileAccessGrant applies the desktop decision. allow/deny require a
// pending request; revoke requires a pending or active grant. A grant that is
// already in the target state is returned unchanged so a retried desktop RPC is
// harmless.
func (s *Store) DecideMobileAccessGrant(
	ctx context.Context,
	mobileDeviceID, deviceID, status string,
	workspaces []protocol.Workspace,
	scopes []string,
	now time.Time,
) (MobileAccessGrantRecord, error) {
	var target mobileaccessgrant.Status
	var allowed []mobileaccessgrant.Status
	switch status {
	case "active":
		target = mobileaccessgrant.StatusActive
		allowed = []mobileaccessgrant.Status{mobileaccessgrant.StatusPending}
	case "denied":
		target = mobileaccessgrant.StatusDenied
		allowed = []mobileaccessgrant.Status{mobileaccessgrant.StatusPending}
	case "revoked":
		target = mobileaccessgrant.StatusRevoked
		allowed = []mobileaccessgrant.Status{mobileaccessgrant.StatusPending, mobileaccessgrant.StatusActive}
	default:
		return MobileAccessGrantRecord{}, ErrMobileGrantState
	}

	existing, err := s.MobileAccessGrant(ctx, mobileDeviceID, deviceID)
	if err != nil {
		return MobileAccessGrantRecord{}, err
	}
	if existing.Status == string(target) {
		return existing, nil
	}

	builder := s.client.MobileAccessGrant.Update().
		Where(
			mobileaccessgrant.MobileDeviceID(mobileDeviceID),
			mobileaccessgrant.DeviceID(deviceID),
			mobileaccessgrant.StatusIn(allowed...),
		).
		SetStatus(target).
		SetDecidedAt(now).
		SetUpdatedAt(now)
	if target == mobileaccessgrant.StatusActive {
		builder.
			SetWorkspaces(toEntWorkspaces(workspaces)).
			SetScopes(append([]string(nil), scopes...))
	}
	updated, err := builder.Save(ctx)
	if err != nil {
		return MobileAccessGrantRecord{}, fmt.Errorf("decide mobile access grant: %w", err)
	}
	if updated == 0 {
		return MobileAccessGrantRecord{}, ErrMobileGrantState
	}
	record, err := s.MobileAccessGrant(ctx, mobileDeviceID, deviceID)
	if err != nil {
		return MobileAccessGrantRecord{}, err
	}
	return record, nil
}

// RevokeMobileAccessGrantByID lets the phone withdraw its own request or grant.
func (s *Store) RevokeMobileAccessGrantByID(ctx context.Context, grantID, mobileDeviceID string, now time.Time) error {
	updated, err := s.client.MobileAccessGrant.Update().
		Where(
			mobileaccessgrant.IDEQ(grantID),
			mobileaccessgrant.MobileDeviceID(mobileDeviceID),
			mobileaccessgrant.StatusIn(mobileaccessgrant.StatusPending, mobileaccessgrant.StatusActive),
		).
		SetStatus(mobileaccessgrant.StatusRevoked).
		SetDecidedAt(now).
		SetUpdatedAt(now).
		Save(ctx)
	if err != nil {
		return fmt.Errorf("revoke mobile access grant: %w", err)
	}
	if updated == 0 {
		return ErrMobileGrantNotFound
	}
	return nil
}

// RevokeMobileAccessGrantsForMobileDevice revokes every grant after logout or
// administrative revocation of the phone.
func (s *Store) RevokeMobileAccessGrantsForMobileDevice(ctx context.Context, mobileDeviceID string, now time.Time) error {
	if _, err := s.client.MobileAccessGrant.Update().
		Where(
			mobileaccessgrant.MobileDeviceID(mobileDeviceID),
			mobileaccessgrant.StatusIn(mobileaccessgrant.StatusPending, mobileaccessgrant.StatusActive),
		).
		SetStatus(mobileaccessgrant.StatusRevoked).
		SetDecidedAt(now).
		SetUpdatedAt(now).
		Save(ctx); err != nil {
		return fmt.Errorf("revoke mobile access grants: %w", err)
	}
	return nil
}

// RevokeMobileAccessGrantsForDevice revokes every phone grant after the desktop
// itself is revoked. It keeps rows for audit.
func (s *Store) RevokeMobileAccessGrantsForDevice(ctx context.Context, deviceID string, now time.Time) error {
	if _, err := s.client.MobileAccessGrant.Update().
		Where(
			mobileaccessgrant.DeviceID(deviceID),
			mobileaccessgrant.StatusIn(mobileaccessgrant.StatusPending, mobileaccessgrant.StatusActive),
		).
		SetStatus(mobileaccessgrant.StatusRevoked).
		SetDecidedAt(now).
		SetUpdatedAt(now).
		Save(ctx); err != nil {
		return fmt.Errorf("revoke desktop mobile access grants: %w", err)
	}
	return nil
}

func toMobileAccessGrantRecords(records []*ent.MobileAccessGrant) []MobileAccessGrantRecord {
	result := make([]MobileAccessGrantRecord, 0, len(records))
	for _, record := range records {
		result = append(result, toMobileAccessGrantRecord(record))
	}
	return result
}

func toMobileAccessGrantRecord(record *ent.MobileAccessGrant) MobileAccessGrantRecord {
	return MobileAccessGrantRecord{
		ID:             record.ID,
		MobileDeviceID: record.MobileDeviceID,
		DeviceID:       record.DeviceID,
		UserID:         record.UserID,
		Workspaces:     toProtocolWorkspaces(record.Workspaces),
		Scopes:         append([]string(nil), record.Scopes...),
		Status:         string(record.Status),
		CreatedAt:      record.CreatedAt,
		UpdatedAt:      record.UpdatedAt,
		DecidedAt:      record.DecidedAt,
	}
}
