package store_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/store"
)

func TestApprovalPolicyDefaultsAndEnsureIsIdempotent(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	if _, err := persistent.ApprovalPolicy(ctx); !errors.Is(err, store.ErrApprovalPolicyNotFound) {
		t.Fatalf("empty ApprovalPolicy error=%v; want ErrApprovalPolicyNotFound", err)
	}

	created, err := persistent.EnsureApprovalPolicy(ctx)
	if err != nil {
		t.Fatalf("EnsureApprovalPolicy: %v", err)
	}
	if created.PolicyID != "default" || !created.RemoteEnabled || created.TTLSeconds != 600 || created.Revision != 1 {
		t.Fatalf("approval policy defaults=%+v", created)
	}
	if created.CreatedAt.IsZero() || created.UpdatedAt.IsZero() {
		t.Fatalf("approval policy timestamps must be populated: %+v", created)
	}

	ensured, err := persistent.EnsureApprovalPolicy(ctx)
	if err != nil {
		t.Fatalf("second EnsureApprovalPolicy: %v", err)
	}
	if ensured != created {
		t.Fatalf("second EnsureApprovalPolicy changed the row: first=%+v second=%+v", created, ensured)
	}
	if err := persistent.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if dialect := persistent.DatabaseDialect(); dialect != "postgres" && dialect != "sqlite" {
		t.Fatalf("DatabaseDialect=%q; want postgres or sqlite", dialect)
	}
}

func TestUpdateApprovalPolicyPartialFieldsAndRevision(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	created, err := persistent.EnsureApprovalPolicy(ctx)
	if err != nil {
		t.Fatalf("EnsureApprovalPolicy: %v", err)
	}

	enabled := false
	ttl := 60
	updated, err := persistent.UpdateApprovalPolicy(ctx, created.Revision, store.ApprovalPolicyUpdate{
		RemoteEnabled: &enabled,
		TTLSeconds:    &ttl,
	})
	if err != nil {
		t.Fatalf("UpdateApprovalPolicy: %v", err)
	}
	if updated.RemoteEnabled || updated.TTLSeconds != 60 || updated.Revision != 2 {
		t.Fatalf("updated approval policy=%+v", updated)
	}
	if !updated.CreatedAt.Equal(created.CreatedAt) || updated.UpdatedAt.Before(created.UpdatedAt) {
		t.Fatalf("update timestamps created=%+v updated=%+v", created, updated)
	}

	ttl = 300
	updated, err = persistent.UpdateApprovalPolicy(ctx, updated.Revision, store.ApprovalPolicyUpdate{TTLSeconds: &ttl})
	if err != nil {
		t.Fatalf("partially update approval policy: %v", err)
	}
	if updated.RemoteEnabled || updated.TTLSeconds != 300 || updated.Revision != 3 {
		t.Fatalf("partial update did not preserve remoteEnabled: %+v", updated)
	}

	enabled = true
	if _, err := persistent.UpdateApprovalPolicy(ctx, 1, store.ApprovalPolicyUpdate{RemoteEnabled: &enabled}); !errors.Is(err, store.ErrApprovalPolicyConflict) {
		t.Fatalf("stale revision error=%v; want ErrApprovalPolicyConflict", err)
	}
	current, err := persistent.ApprovalPolicy(ctx)
	if err != nil {
		t.Fatalf("ApprovalPolicy: %v", err)
	}
	if current != updated {
		t.Fatalf("revision conflict changed the policy: current=%+v updated=%+v", current, updated)
	}
}

func TestUpdateApprovalPolicyHasSingleRevisionWinner(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	created, err := persistent.EnsureApprovalPolicy(ctx)
	if err != nil {
		t.Fatalf("EnsureApprovalPolicy: %v", err)
	}

	start := make(chan struct{})
	errorsByUpdate := make(chan error, 2)
	var workers sync.WaitGroup
	for _, ttl := range []int{60, 300} {
		ttl := ttl
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			_, updateErr := persistent.UpdateApprovalPolicy(ctx, created.Revision, store.ApprovalPolicyUpdate{TTLSeconds: &ttl})
			errorsByUpdate <- updateErr
		}()
	}
	close(start)
	workers.Wait()
	close(errorsByUpdate)

	succeeded, conflicted := 0, 0
	for updateErr := range errorsByUpdate {
		switch {
		case updateErr == nil:
			succeeded++
		case errors.Is(updateErr, store.ErrApprovalPolicyConflict):
			conflicted++
		default:
			t.Fatalf("concurrent UpdateApprovalPolicy error=%v", updateErr)
		}
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("concurrent updates succeeded=%d conflicted=%d; want 1/1", succeeded, conflicted)
	}
	current, err := persistent.ApprovalPolicy(ctx)
	if err != nil {
		t.Fatalf("ApprovalPolicy: %v", err)
	}
	if current.Revision != 2 || (current.TTLSeconds != 60 && current.TTLSeconds != 300) {
		t.Fatalf("policy after concurrent updates=%+v", current)
	}
}

func TestApprovalPolicyNotFoundAndRecreated(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	created, err := persistent.EnsureApprovalPolicy(ctx)
	if err != nil {
		t.Fatalf("EnsureApprovalPolicy: %v", err)
	}
	if err := persistent.Client().ApprovalPolicy.DeleteOneID(created.PolicyID).Exec(ctx); err != nil {
		t.Fatalf("delete approval policy fixture: %v", err)
	}

	enabled := false
	if _, err := persistent.UpdateApprovalPolicy(ctx, created.Revision, store.ApprovalPolicyUpdate{RemoteEnabled: &enabled}); !errors.Is(err, store.ErrApprovalPolicyNotFound) {
		t.Fatalf("update missing policy error=%v; want ErrApprovalPolicyNotFound", err)
	}
	recreated, err := persistent.EnsureApprovalPolicy(ctx)
	if err != nil {
		t.Fatalf("recreate approval policy: %v", err)
	}
	if recreated.PolicyID != "default" || !recreated.RemoteEnabled || recreated.TTLSeconds != 600 || recreated.Revision != 1 {
		t.Fatalf("recreated approval policy=%+v", recreated)
	}
	if !recreated.CreatedAt.After(created.CreatedAt.Add(-time.Second)) {
		t.Fatalf("recreated createdAt=%s; original=%s", recreated.CreatedAt, created.CreatedAt)
	}
}
