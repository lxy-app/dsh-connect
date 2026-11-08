package store_test

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/store"
)

func TestCreateAccessPolicy(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	input := store.AccessPolicyRecord{
		PolicyID:    "ap-create",
		Name:        "Operators",
		Description: "Operations team access",
		Enabled:     true,
		MemberIDs:   []string{"usr-1", "usr-2"},
		Rules: []store.AccessPolicyRule{{
			DeviceID:     "dev-1",
			WorkspaceIDs: []string{"ws-1", "ws-2"},
			Scopes:       []string{"read", "prompt"},
		}},
		CreatedAt: now,
		UpdatedAt: now,
	}

	created, err := persistent.CreateAccessPolicy(ctx, input)
	if err != nil {
		t.Fatalf("CreateAccessPolicy: %v", err)
	}
	want := input
	want.Revision = 1
	if !reflect.DeepEqual(created, want) {
		t.Fatalf("created access policy=%+v; want %+v", created, want)
	}
}

func TestAccessPoliciesSortByCreatedAt(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	base := time.Now().UTC().Add(-time.Hour).Truncate(time.Millisecond)
	for _, record := range []store.AccessPolicyRecord{
		{PolicyID: "ap-later", Name: "Later", CreatedAt: base.Add(time.Minute)},
		{PolicyID: "ap-earlier", Name: "Earlier", CreatedAt: base},
	} {
		if _, err := persistent.CreateAccessPolicy(ctx, record); err != nil {
			t.Fatalf("create access policy %s: %v", record.PolicyID, err)
		}
	}

	policies, err := persistent.AccessPolicies(ctx)
	if err != nil {
		t.Fatalf("AccessPolicies: %v", err)
	}
	if len(policies) != 2 || policies[0].PolicyID != "ap-earlier" || policies[1].PolicyID != "ap-later" {
		t.Fatalf("access policies not sorted by createdAt: %+v", policies)
	}
}

func TestUpdateAccessPolicy(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	created, err := persistent.CreateAccessPolicy(ctx, store.AccessPolicyRecord{
		PolicyID:    "ap-update",
		Name:        "Before",
		Description: "before",
		Enabled:     true,
		MemberIDs:   []string{"usr-before"},
		Rules: []store.AccessPolicyRule{{
			DeviceID: "dev-before", WorkspaceIDs: []string{"ws-before"}, Scopes: []string{"read"},
		}},
	})
	if err != nil {
		t.Fatalf("CreateAccessPolicy: %v", err)
	}

	name := "After"
	description := "after"
	enabled := false
	memberIDs := []string{"usr-after-1", "usr-after-2"}
	rules := []store.AccessPolicyRule{{
		DeviceID: "dev-after", WorkspaceIDs: []string{"ws-after"}, Scopes: []string{"read", "cancel"},
	}}
	updated, err := persistent.UpdateAccessPolicy(ctx, created.PolicyID, created.Revision, store.AccessPolicyUpdate{
		Name: &name, Description: &description, Enabled: &enabled, MemberIDs: &memberIDs, Rules: &rules,
	})
	if err != nil {
		t.Fatalf("UpdateAccessPolicy: %v", err)
	}
	if updated.Name != name || updated.Description != description || updated.Enabled != enabled ||
		!reflect.DeepEqual(updated.MemberIDs, memberIDs) || !reflect.DeepEqual(updated.Rules, rules) {
		t.Fatalf("updated access policy=%+v", updated)
	}
	if updated.Revision != created.Revision+1 {
		t.Fatalf("updated revision=%d; want %d", updated.Revision, created.Revision+1)
	}
	if !updated.CreatedAt.Equal(created.CreatedAt) {
		t.Fatalf("createdAt changed from %s to %s", created.CreatedAt, updated.CreatedAt)
	}
	if !updated.UpdatedAt.After(created.UpdatedAt) {
		t.Fatalf("updatedAt=%s; want after %s", updated.UpdatedAt, created.UpdatedAt)
	}

	// Nil fields preserve their values while a pointer to an empty string clears
	// the optional description.
	updated, err = persistent.UpdateAccessPolicy(ctx, created.PolicyID, updated.Revision, store.AccessPolicyUpdate{
		Description: new(string),
	})
	if err != nil {
		t.Fatalf("partially update access policy: %v", err)
	}
	if updated.Name != name || updated.Enabled != enabled || updated.Description != "" ||
		!reflect.DeepEqual(updated.MemberIDs, memberIDs) || !reflect.DeepEqual(updated.Rules, rules) || updated.Revision != 3 {
		t.Fatalf("partially updated access policy=%+v", updated)
	}
}

func TestAccessPolicyNameConflicts(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	if _, err := persistent.CreateAccessPolicy(ctx, store.AccessPolicyRecord{PolicyID: "ap-first", Name: "Shared"}); err != nil {
		t.Fatalf("create first access policy: %v", err)
	}
	if _, err := persistent.CreateAccessPolicy(ctx, store.AccessPolicyRecord{PolicyID: "ap-duplicate", Name: "Shared"}); !errors.Is(err, store.ErrAccessPolicyNameTaken) {
		t.Fatalf("duplicate name error=%v; want ErrAccessPolicyNameTaken", err)
	}
	second, err := persistent.CreateAccessPolicy(ctx, store.AccessPolicyRecord{PolicyID: "ap-second", Name: "Second"})
	if err != nil {
		t.Fatalf("create second access policy: %v", err)
	}
	name := "Shared"
	if _, err := persistent.UpdateAccessPolicy(ctx, second.PolicyID, second.Revision, store.AccessPolicyUpdate{Name: &name}); !errors.Is(err, store.ErrAccessPolicyNameTaken) {
		t.Fatalf("update duplicate name error=%v; want ErrAccessPolicyNameTaken", err)
	}
	policies, err := persistent.AccessPolicies(ctx)
	if err != nil {
		t.Fatalf("AccessPolicies: %v", err)
	}
	if len(policies) != 2 || policies[1].Name != "Second" || policies[1].Revision != second.Revision {
		t.Fatalf("name conflict changed the target policy: %+v", policies)
	}
}

func TestAccessPolicyRevisionConflicts(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	created, err := persistent.CreateAccessPolicy(ctx, store.AccessPolicyRecord{PolicyID: "ap-conflict", Name: "Original"})
	if err != nil {
		t.Fatalf("CreateAccessPolicy: %v", err)
	}
	name := "Changed"
	if _, err := persistent.UpdateAccessPolicy(ctx, created.PolicyID, created.Revision-1, store.AccessPolicyUpdate{Name: &name}); !errors.Is(err, store.ErrAccessPolicyConflict) {
		t.Fatalf("stale update error=%v; want ErrAccessPolicyConflict", err)
	}
	if err := persistent.DeleteAccessPolicy(ctx, created.PolicyID, created.Revision-1); !errors.Is(err, store.ErrAccessPolicyConflict) {
		t.Fatalf("stale delete error=%v; want ErrAccessPolicyConflict", err)
	}
	policies, err := persistent.AccessPolicies(ctx)
	if err != nil {
		t.Fatalf("AccessPolicies: %v", err)
	}
	if len(policies) != 1 || policies[0].Name != "Original" || policies[0].Revision != created.Revision {
		t.Fatalf("revision conflict changed the policy: %+v", policies)
	}
}

func TestDeleteAccessPolicy(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	created, err := persistent.CreateAccessPolicy(ctx, store.AccessPolicyRecord{PolicyID: "ap-delete", Name: "Delete"})
	if err != nil {
		t.Fatalf("CreateAccessPolicy: %v", err)
	}
	if err := persistent.DeleteAccessPolicy(ctx, created.PolicyID, created.Revision); err != nil {
		t.Fatalf("DeleteAccessPolicy: %v", err)
	}
	policies, err := persistent.AccessPolicies(ctx)
	if err != nil {
		t.Fatalf("AccessPolicies: %v", err)
	}
	if len(policies) != 0 {
		t.Fatalf("deleted policy remains: %+v", policies)
	}
}

func TestAccessPolicyNotFound(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	name := "Missing"
	if _, err := persistent.UpdateAccessPolicy(ctx, "ap-missing", 1, store.AccessPolicyUpdate{Name: &name}); !errors.Is(err, store.ErrAccessPolicyNotFound) {
		t.Fatalf("update missing policy error=%v; want ErrAccessPolicyNotFound", err)
	}
	if err := persistent.DeleteAccessPolicy(ctx, "ap-missing", 1); !errors.Is(err, store.ErrAccessPolicyNotFound) {
		t.Fatalf("delete missing policy error=%v; want ErrAccessPolicyNotFound", err)
	}
}
