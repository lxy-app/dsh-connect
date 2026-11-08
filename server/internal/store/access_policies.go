package store

import (
	"context"
	"fmt"
	"time"

	"github.com/deepseek/dsh-connect/server/ent"
	"github.com/deepseek/dsh-connect/server/ent/accesspolicy"
	entschema "github.com/deepseek/dsh-connect/server/ent/schema"
)

// AccessPolicyRecord is the persisted administrative access policy projection.
type AccessPolicyRecord struct {
	PolicyID    string             `json:"policyId"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Enabled     bool               `json:"enabled"`
	MemberIDs   []string           `json:"memberIds"`
	Rules       []AccessPolicyRule `json:"rules"`
	Revision    int64              `json:"revision"`
	CreatedAt   time.Time          `json:"createdAt"`
	UpdatedAt   time.Time          `json:"updatedAt"`
}

// AccessPolicyRule grants selected workspaces and scopes on one desktop.
type AccessPolicyRule struct {
	DeviceID     string   `json:"deviceId"`
	WorkspaceIDs []string `json:"workspaceIds"`
	Scopes       []string `json:"scopes"`
}

// AccessPolicyUpdate carries optional access policy changes.
type AccessPolicyUpdate struct {
	Name        *string
	Description *string
	Enabled     *bool
	MemberIDs   *[]string
	Rules       *[]AccessPolicyRule
}

// CreateAccessPolicy inserts an access policy.
func (s *Store) CreateAccessPolicy(ctx context.Context, record AccessPolicyRecord) (AccessPolicyRecord, error) {
	builder := s.client.AccessPolicy.Create().
		SetID(record.PolicyID).
		SetName(record.Name).
		SetDescription(record.Description).
		SetEnabled(record.Enabled).
		SetMemberIds(append([]string(nil), record.MemberIDs...)).
		SetRules(toEntAccessPolicyRules(record.Rules))
	if !record.CreatedAt.IsZero() {
		builder.SetCreatedAt(record.CreatedAt)
	}
	if !record.UpdatedAt.IsZero() {
		builder.SetUpdatedAt(record.UpdatedAt)
	}
	created, err := builder.Save(ctx)
	if err != nil {
		if ent.IsConstraintError(err) {
			return AccessPolicyRecord{}, ErrAccessPolicyNameTaken
		}
		return AccessPolicyRecord{}, fmt.Errorf("create access policy: %w", err)
	}
	return toAccessPolicyRecord(created), nil
}

// AccessPolicies lists access policies ordered by creation time.
func (s *Store) AccessPolicies(ctx context.Context) ([]AccessPolicyRecord, error) {
	records, err := s.client.AccessPolicy.Query().
		Order(ent.Asc(accesspolicy.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list access policies: %w", err)
	}
	result := make([]AccessPolicyRecord, 0, len(records))
	for _, record := range records {
		result = append(result, toAccessPolicyRecord(record))
	}
	return result, nil
}

// UpdateAccessPolicy applies a partial update when the expected revision is current.
func (s *Store) UpdateAccessPolicy(ctx context.Context, policyID string, revision int64, update AccessPolicyUpdate) (AccessPolicyRecord, error) {
	builder := s.client.AccessPolicy.Update().
		Where(accesspolicy.IDEQ(policyID), accesspolicy.RevisionEQ(revision)).
		SetUpdatedAt(time.Now().UTC()).
		AddRevision(1)
	if update.Name != nil {
		builder.SetName(*update.Name)
	}
	if update.Description != nil {
		builder.SetDescription(*update.Description)
	}
	if update.Enabled != nil {
		builder.SetEnabled(*update.Enabled)
	}
	if update.MemberIDs != nil {
		builder.SetMemberIds(append([]string(nil), (*update.MemberIDs)...))
	}
	if update.Rules != nil {
		builder.SetRules(toEntAccessPolicyRules(*update.Rules))
	}
	affected, err := builder.Save(ctx)
	if err != nil {
		if ent.IsConstraintError(err) {
			return AccessPolicyRecord{}, ErrAccessPolicyNameTaken
		}
		return AccessPolicyRecord{}, fmt.Errorf("update access policy: %w", err)
	}
	if affected == 0 {
		return AccessPolicyRecord{}, s.accessPolicyConditionError(ctx, policyID, "update")
	}
	updated, err := s.client.AccessPolicy.Query().Where(accesspolicy.IDEQ(policyID)).Only(ctx)
	if ent.IsNotFound(err) {
		return AccessPolicyRecord{}, ErrAccessPolicyNotFound
	}
	if err != nil {
		return AccessPolicyRecord{}, fmt.Errorf("reload updated access policy: %w", err)
	}
	return toAccessPolicyRecord(updated), nil
}

// DeleteAccessPolicy removes an access policy when the expected revision is current.
func (s *Store) DeleteAccessPolicy(ctx context.Context, policyID string, revision int64) error {
	affected, err := s.client.AccessPolicy.Delete().
		Where(accesspolicy.IDEQ(policyID), accesspolicy.RevisionEQ(revision)).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("delete access policy: %w", err)
	}
	if affected == 0 {
		return s.accessPolicyConditionError(ctx, policyID, "delete")
	}
	return nil
}

func (s *Store) accessPolicyConditionError(ctx context.Context, policyID, operation string) error {
	exists, err := s.client.AccessPolicy.Query().Where(accesspolicy.IDEQ(policyID)).Exist(ctx)
	if err != nil {
		return fmt.Errorf("check access policy after %s: %w", operation, err)
	}
	if !exists {
		return ErrAccessPolicyNotFound
	}
	return ErrAccessPolicyConflict
}

func toAccessPolicyRecord(record *ent.AccessPolicy) AccessPolicyRecord {
	return AccessPolicyRecord{
		PolicyID:    record.ID,
		Name:        record.Name,
		Description: record.Description,
		Enabled:     record.Enabled,
		MemberIDs:   append([]string(nil), record.MemberIds...),
		Rules:       toAccessPolicyRules(record.Rules),
		Revision:    record.Revision,
		CreatedAt:   record.CreatedAt,
		UpdatedAt:   record.UpdatedAt,
	}
}

func toAccessPolicyRules(rules []entschema.AccessPolicyRule) []AccessPolicyRule {
	result := make([]AccessPolicyRule, 0, len(rules))
	for _, rule := range rules {
		result = append(result, AccessPolicyRule{
			DeviceID:     rule.DeviceID,
			WorkspaceIDs: append([]string(nil), rule.WorkspaceIDs...),
			Scopes:       append([]string(nil), rule.Scopes...),
		})
	}
	return result
}

func toEntAccessPolicyRules(rules []AccessPolicyRule) []entschema.AccessPolicyRule {
	result := make([]entschema.AccessPolicyRule, 0, len(rules))
	for _, rule := range rules {
		result = append(result, entschema.AccessPolicyRule{
			DeviceID:     rule.DeviceID,
			WorkspaceIDs: append([]string(nil), rule.WorkspaceIDs...),
			Scopes:       append([]string(nil), rule.Scopes...),
		})
	}
	return result
}
