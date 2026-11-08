package store_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/store"
)

type ownerRemovalOperation struct {
	name  string
	apply func(ctx context.Context, persistent *store.Store, userID string) error
}

var ownerRemovalOperations = map[string]ownerRemovalOperation{
	"demote": {
		name: "demote",
		apply: func(ctx context.Context, persistent *store.Store, userID string) error {
			role := store.RoleAdmin
			_, err := persistent.UpdateUser(ctx, userID, store.UserUpdate{Role: &role})
			return err
		},
	},
	"disable": {
		name: "disable",
		apply: func(ctx context.Context, persistent *store.Store, userID string) error {
			status := store.UserStatusDisabled
			_, err := persistent.UpdateUser(ctx, userID, store.UserUpdate{Status: &status})
			return err
		},
	},
	"delete": {
		name: "delete",
		apply: func(ctx context.Context, persistent *store.Store, userID string) error {
			return persistent.DeleteUser(ctx, userID)
		},
	},
}

func TestConcurrentOwnerRemovalKeepsLastActiveOwner(t *testing.T) {
	for _, test := range []struct {
		name   string
		first  string
		second string
	}{
		{name: "demote and demote", first: "demote", second: "demote"},
		{name: "disable and disable", first: "disable", second: "disable"},
		{name: "delete and delete", first: "delete", second: "delete"},
		{name: "demote and delete", first: "demote", second: "delete"},
	} {
		t.Run(test.name, func(t *testing.T) {
			persistent := newStore(t)
			ctx := context.Background()
			first, err := persistent.CreateUser(ctx, "usr-owner-1", "owner1@example.com", "Owner One", "owner-password", store.RoleOwner)
			if err != nil {
				t.Fatalf("create first owner: %v", err)
			}
			second, err := persistent.CreateUser(ctx, "usr-owner-2", "owner2@example.com", "Owner Two", "owner-password", store.RoleOwner)
			if err != nil {
				t.Fatalf("create second owner: %v", err)
			}

			start := make(chan struct{})
			results := make(chan error, 2)
			var workers sync.WaitGroup
			operations := []struct {
				target    store.User
				operation ownerRemovalOperation
			}{
				{target: first, operation: ownerRemovalOperations[test.first]},
				{target: second, operation: ownerRemovalOperations[test.second]},
			}
			for _, item := range operations {
				workers.Add(1)
				go func() {
					defer workers.Done()
					<-start
					results <- item.operation.apply(ctx, persistent, item.target.ID)
				}()
			}
			close(start)
			workers.Wait()
			close(results)

			succeeded := 0
			blocked := 0
			for err := range results {
				switch {
				case err == nil:
					succeeded++
				case errors.Is(err, store.ErrLastActiveOwner):
					blocked++
				default:
					t.Fatalf("concurrent owner removal error: %v", err)
				}
			}
			if succeeded != 1 || blocked != 1 {
				t.Fatalf("concurrent owner removal succeeded=%d blocked=%d; want 1 and 1", succeeded, blocked)
			}
			assertActiveOwnerCount(t, persistent, 1)
		})
	}
}

func TestUpdateUserExcludingOwnerRejectsOwnerCredentials(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	owner, err := persistent.CreateUser(ctx, "usr-owner", "owner@example.com", "Owner", "owner-password", store.RoleOwner)
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	newPassword := "admin-controlled-password"
	if _, err := persistent.UpdateUserExcludingOwner(ctx, owner.ID, store.UserUpdate{Password: &newPassword}); !errors.Is(err, store.ErrOwnerUpdateForbidden) {
		t.Fatalf("admin owner update error=%v; want ErrOwnerUpdateForbidden", err)
	}
	persisted, err := persistent.UserByEmail(ctx, owner.Email)
	if err != nil {
		t.Fatalf("reload owner: %v", err)
	}
	if !store.CheckPassword(persisted.PasswordHash, "owner-password") || store.CheckPassword(persisted.PasswordHash, newPassword) {
		t.Fatal("forbidden admin update changed the owner password")
	}
}

func TestDeleteLastActiveOwnerLeavesAdminSessionIntact(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	owner, err := persistent.CreateUser(ctx, "usr-owner", "owner@example.com", "Owner", "owner-password", store.RoleOwner)
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	if _, err := persistent.CreateAdminSession(ctx, "admin-token", "ses-owner", owner.ID, time.Hour, "", ""); err != nil {
		t.Fatalf("create owner session: %v", err)
	}
	if err := persistent.DeleteUser(ctx, owner.ID); !errors.Is(err, store.ErrLastActiveOwner) {
		t.Fatalf("delete last active owner error=%v; want ErrLastActiveOwner", err)
	}
	if _, err := persistent.AdminSessionUser(ctx, "admin-token", time.Now().UTC()); err != nil {
		t.Fatalf("rejected delete changed the owner session: %v", err)
	}
}

func TestDeleteOneOfTwoOwnersRevokesOnlyThatOwner(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	remaining, err := persistent.CreateUser(ctx, "usr-owner-1", "owner1@example.com", "Owner One", "owner-password", store.RoleOwner)
	if err != nil {
		t.Fatalf("create remaining owner: %v", err)
	}
	removed, err := persistent.CreateUser(ctx, "usr-owner-2", "owner2@example.com", "Owner Two", "owner-password", store.RoleOwner)
	if err != nil {
		t.Fatalf("create removed owner: %v", err)
	}
	if _, err := persistent.CreateAdminSession(ctx, "removed-token", "ses-removed", removed.ID, time.Hour, "", ""); err != nil {
		t.Fatalf("create removed owner session: %v", err)
	}
	if _, err := persistent.CreateAdminSession(ctx, "remaining-token", "ses-remaining", remaining.ID, time.Hour, "", ""); err != nil {
		t.Fatalf("create remaining owner session: %v", err)
	}

	if err := persistent.DeleteUser(ctx, removed.ID); err != nil {
		t.Fatalf("delete one of two active owners: %v", err)
	}
	if _, err := persistent.AdminSessionUser(ctx, "removed-token", time.Now().UTC()); !errors.Is(err, store.ErrSessionInvalid) {
		t.Fatalf("removed owner session error=%v; want ErrSessionInvalid", err)
	}
	if _, err := persistent.AdminSessionUser(ctx, "remaining-token", time.Now().UTC()); err != nil {
		t.Fatalf("remaining owner session was affected: %v", err)
	}
	assertActiveOwnerCount(t, persistent, 1)
}

func assertActiveOwnerCount(t *testing.T, persistent *store.Store, want int) {
	t.Helper()
	users, err := persistent.Users(context.Background())
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	activeOwners := 0
	for _, candidate := range users {
		if candidate.Role == store.RoleOwner && candidate.Status == store.UserStatusActive {
			activeOwners++
		}
	}
	if activeOwners != want {
		t.Fatalf("active owners=%d; want %d", activeOwners, want)
	}
}
