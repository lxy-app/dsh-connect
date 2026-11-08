package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/deepseek/dsh-connect/server/ent"
	"github.com/deepseek/dsh-connect/server/ent/approvalpolicy"
)

const defaultApprovalPolicyID = "default"

// ApprovalPolicyRecord is the singleton remote-approval policy projection. Its
// database identity is internal because there is exactly one policy per Server.
type ApprovalPolicyRecord struct {
	PolicyID      string    `json:"-"`
	RemoteEnabled bool      `json:"remoteEnabled"`
	TTLSeconds    int       `json:"ttlSeconds"`
	Revision      int64     `json:"revision"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// ApprovalPolicyUpdate carries optional remote-approval policy changes.
type ApprovalPolicyUpdate struct {
	RemoteEnabled *bool
	TTLSeconds    *int
}

// EnsureApprovalPolicy returns the singleton policy, creating its preserving-
// behavior defaults on first use. Concurrent initialization remains idempotent.
func (s *Store) EnsureApprovalPolicy(ctx context.Context) (ApprovalPolicyRecord, error) {
	record, err := s.ApprovalPolicy(ctx)
	if err == nil {
		return record, nil
	}
	if !errors.Is(err, ErrApprovalPolicyNotFound) {
		return ApprovalPolicyRecord{}, err
	}
	if _, err := s.client.ApprovalPolicy.Create().SetID(defaultApprovalPolicyID).Save(ctx); err != nil && !ent.IsConstraintError(err) {
		return ApprovalPolicyRecord{}, fmt.Errorf("ensure approval policy: %w", err)
	}
	record, err = s.ApprovalPolicy(ctx)
	if err != nil {
		return ApprovalPolicyRecord{}, fmt.Errorf("reload ensured approval policy: %w", err)
	}
	return record, nil
}

// ApprovalPolicy loads the singleton remote-approval policy.
func (s *Store) ApprovalPolicy(ctx context.Context) (ApprovalPolicyRecord, error) {
	record, err := s.client.ApprovalPolicy.Query().Where(approvalpolicy.IDEQ(defaultApprovalPolicyID)).Only(ctx)
	if ent.IsNotFound(err) {
		return ApprovalPolicyRecord{}, ErrApprovalPolicyNotFound
	}
	if err != nil {
		return ApprovalPolicyRecord{}, fmt.Errorf("load approval policy: %w", err)
	}
	return toApprovalPolicyRecord(record), nil
}

// UpdateApprovalPolicy applies a partial update only when revision is current.
func (s *Store) UpdateApprovalPolicy(ctx context.Context, revision int64, update ApprovalPolicyUpdate) (ApprovalPolicyRecord, error) {
	builder := s.client.ApprovalPolicy.Update().
		Where(approvalpolicy.IDEQ(defaultApprovalPolicyID), approvalpolicy.RevisionEQ(revision)).
		SetUpdatedAt(time.Now().UTC()).
		AddRevision(1)
	if update.RemoteEnabled != nil {
		builder.SetRemoteEnabled(*update.RemoteEnabled)
	}
	if update.TTLSeconds != nil {
		builder.SetTTLSeconds(*update.TTLSeconds)
	}
	affected, err := builder.Save(ctx)
	if err != nil {
		return ApprovalPolicyRecord{}, fmt.Errorf("update approval policy: %w", err)
	}
	if affected == 0 {
		if _, err := s.ApprovalPolicy(ctx); errors.Is(err, ErrApprovalPolicyNotFound) {
			return ApprovalPolicyRecord{}, ErrApprovalPolicyNotFound
		} else if err != nil {
			return ApprovalPolicyRecord{}, fmt.Errorf("check approval policy after update: %w", err)
		}
		return ApprovalPolicyRecord{}, ErrApprovalPolicyConflict
	}
	record, err := s.ApprovalPolicy(ctx)
	if err != nil {
		return ApprovalPolicyRecord{}, fmt.Errorf("reload updated approval policy: %w", err)
	}
	return record, nil
}

func toApprovalPolicyRecord(record *ent.ApprovalPolicy) ApprovalPolicyRecord {
	return ApprovalPolicyRecord{
		PolicyID:      record.ID,
		RemoteEnabled: record.RemoteEnabled,
		TTLSeconds:    record.TTLSeconds,
		Revision:      record.Revision,
		CreatedAt:     record.CreatedAt,
		UpdatedAt:     record.UpdatedAt,
	}
}
