package store_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	entsqlschema "entgo.io/ent/dialect/sql/schema"
	entmigrate "github.com/deepseek/dsh-connect/server/ent/migrate"
	"github.com/deepseek/dsh-connect/server/internal/dbtest"
	"github.com/deepseek/dsh-connect/server/internal/pgtest"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

func TestMain(m *testing.M) {
	code := m.Run()
	pgtest.CleanupContainer()
	os.Exit(code)
}

// newStore opens a migrated store on a fresh, isolated database.
func newStore(t *testing.T) *store.Store {
	t.Helper()
	dsn := dbtest.NewDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	persistent, err := store.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	if err := persistent.Migrate(ctx); err != nil {
		t.Fatalf("migrate store: %v", err)
	}
	t.Cleanup(func() { _ = persistent.Close() })
	return persistent
}

func TestStorePersistsAcrossReopen(t *testing.T) {
	dsn := dbtest.NewDatabase(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)

	first, err := store.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	if err := first.Migrate(ctx); err != nil {
		t.Fatalf("migrate store: %v", err)
	}
	record := store.IdempotencyRecord{
		RequestID:   "req-1",
		Method:      protocol.MethodSessionPrompt,
		DeviceID:    "dev-1",
		RequestHash: "hash",
		Result:      json.RawMessage(`{"status":"accepted"}`),
		CreatedAt:   now,
		CompletedAt: now,
	}
	if err := first.CompleteIdempotency(ctx, record); err != nil {
		t.Fatalf("complete idempotency: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	reopened, err := store.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	defer reopened.Close()
	persisted, found, err := reopened.Idempotency(ctx, "req-1")
	if err != nil {
		t.Fatalf("load idempotency: %v", err)
	}
	if !found || string(persisted.Result) != `{"status":"accepted"}` {
		t.Fatalf("persisted idempotency=%+v, found=%v", persisted, found)
	}
}

func TestMigrateUpgradesAdditiveSchema(t *testing.T) {
	dsn := dbtest.NewDatabase(t)
	ctx := context.Background()
	persistent, err := store.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer persistent.Close()

	// Simulate an older installation with only the devices table and without
	// last_seen_at. Ent must add the new column and all other current tables
	// without discarding the existing device row on either dialect.
	columns := entmigrate.DevicesTable.Columns
	lastColumn := columns[len(columns)-1].Name
	if lastColumn != "last_seen_at" {
		t.Fatalf("unexpected devices schema fixture tail: %s", lastColumn)
	}
	legacyDevices := entsqlschema.NewTable(entmigrate.DevicesTable.Name)
	for _, column := range columns[:len(columns)-1] {
		legacyDevices.AddColumn(column)
	}
	legacyDevices.PrimaryKey = entmigrate.DevicesTable.PrimaryKey
	legacyDevices.Indexes = entmigrate.DevicesTable.Indexes
	if err := entmigrate.Create(ctx, persistent.Client().Schema, []*entsqlschema.Table{legacyDevices}); err != nil {
		t.Fatalf("create legacy schema: %v", err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	record := store.DeviceRecord{Device: protocol.Device{
		DeviceID: "dev-legacy", DeviceName: "Legacy", Status: "offline",
		CreatedAt: now, UpdatedAt: now,
	}}
	if err := persistent.CreateDevice(ctx, record); err != nil {
		t.Fatalf("seed legacy device: %v", err)
	}
	if err := persistent.Migrate(ctx); err != nil {
		t.Fatalf("upgrade legacy schema: %v", err)
	}
	if err := persistent.SetDeviceStatus(ctx, record.Device.DeviceID, "online", now); err != nil {
		t.Fatalf("use added last_seen_at column: %v", err)
	}
	loaded, err := persistent.Device(ctx, record.Device.DeviceID)
	if err != nil {
		t.Fatalf("load migrated device: %v", err)
	}
	if loaded.Device.LastSeenAt == nil || !loaded.Device.LastSeenAt.Equal(now) {
		t.Fatalf("migrated device lastSeenAt=%v; want %v", loaded.Device.LastSeenAt, now)
	}
	if err := persistent.AppendAudit(ctx, store.AuditEntry{
		OccurredAt: now, Actor: "test", Action: "schema.upgrade", Result: "success",
	}); err != nil {
		t.Fatalf("use table created by upgrade: %v", err)
	}
}

func TestIdempotencyRejectsDuplicateRequestID(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	record := store.IdempotencyRecord{
		RequestID:   "req-duplicate",
		Method:      protocol.MethodSessionPrompt,
		DeviceID:    "dev-1",
		RequestHash: "hash",
		Result:      json.RawMessage(`{"status":"accepted"}`),
		CreatedAt:   now,
		CompletedAt: now,
	}
	if err := persistent.CompleteIdempotency(ctx, record); err != nil {
		t.Fatalf("first CompleteIdempotency: %v", err)
	}
	if err := persistent.CompleteIdempotency(ctx, record); !errors.Is(err, store.ErrIdempotencyExists) {
		t.Fatalf("duplicate CompleteIdempotency error=%v; want ErrIdempotencyExists", err)
	}
}

func TestPromptCompletionsFiltersAndReturnsEveryAdmission(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	base := time.Now().UTC().Add(-time.Hour).Truncate(time.Millisecond)

	// Insert in reverse time order and exceed the Admin audit page ceiling to
	// prove this operational metric is neither paginated nor implicitly capped.
	for index := 0; index < 501; index++ {
		completedAt := base.Add(time.Duration(500-index) * time.Second)
		record := store.IdempotencyRecord{
			RequestID: fmt.Sprintf("prompt-completion-%03d", index), Method: protocol.MethodSessionPrompt,
			DeviceID: "dev-1", RequestHash: "not-needed-for-metrics", Result: json.RawMessage(`{"status":"accepted"}`),
			CreatedAt: completedAt.Add(-time.Second), CompletedAt: completedAt,
		}
		if err := persistent.CompleteIdempotency(ctx, record); err != nil {
			t.Fatalf("CompleteIdempotency %d: %v", index, err)
		}
	}
	excluded := []store.IdempotencyRecord{
		{RequestID: "prompt-before-since", Method: protocol.MethodSessionPrompt, DeviceID: "dev-1", RequestHash: "hash", CreatedAt: base.Add(-2 * time.Second), CompletedAt: base.Add(-time.Second)},
		{RequestID: "prompt-create", Method: protocol.MethodSessionCreate, DeviceID: "dev-1", RequestHash: "hash", CreatedAt: base, CompletedAt: base.Add(time.Second)},
		{RequestID: "prompt-error", Method: protocol.MethodSessionPrompt, DeviceID: "dev-1", RequestHash: "hash", CreatedAt: base, CompletedAt: base.Add(time.Second), Error: &protocol.Error{Code: protocol.CodeCommandTimeout, Message: "timeout", Retryable: true}},
	}
	for _, record := range excluded {
		if err := persistent.CompleteIdempotency(ctx, record); err != nil {
			t.Fatalf("CompleteIdempotency excluded %s: %v", record.RequestID, err)
		}
	}

	completions, err := persistent.PromptCompletions(ctx, base)
	if err != nil {
		t.Fatalf("PromptCompletions: %v", err)
	}
	if len(completions) != 501 {
		t.Fatalf("PromptCompletions len=%d; want all 501 successful prompt admissions", len(completions))
	}
	if !completions[0].Equal(base) || !completions[len(completions)-1].Equal(base.Add(500*time.Second)) {
		t.Fatalf("PromptCompletions not sorted by completedAt: first=%s last=%s", completions[0], completions[len(completions)-1])
	}
	for index := 1; index < len(completions); index++ {
		if completions[index].Before(completions[index-1]) {
			t.Fatalf("PromptCompletions out of order at %d", index)
		}
	}

	bounded, err := persistent.PromptCompletions(ctx, base.Add(250*time.Second))
	if err != nil {
		t.Fatalf("PromptCompletions bounded: %v", err)
	}
	if len(bounded) != 251 {
		t.Fatalf("bounded PromptCompletions len=%d; want 251 inclusive rows", len(bounded))
	}
	if !bounded[0].Equal(base.Add(250 * time.Second)) {
		t.Fatalf("bounded PromptCompletions first=%s; want inclusive since boundary", bounded[0])
	}
}

func TestPairingCodeCanOnlyBeConsumedOnce(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	code := "code"
	if _, err := persistent.CreatePairingCode(ctx, store.PairingCode{
		CodeHash:  store.HashToken(code),
		CreatedAt: now,
		ExpiresAt: now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("create pairing code: %v", err)
	}
	device := store.DeviceRecord{
		Device: protocol.Device{
			DeviceID:  "dev-1",
			Status:    "waiting_desktop_authorization",
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
	if err := persistent.BeginPairing(ctx, store.HashToken(code), device); err != nil {
		t.Fatalf("first BeginPairing: %v", err)
	}
	device.Device.DeviceID = "dev-2"
	if err := persistent.BeginPairing(ctx, store.HashToken(code), device); !errors.Is(err, store.ErrPairingCodeUsed) {
		t.Fatalf("second BeginPairing error=%v; want ErrPairingCodeUsed", err)
	}
}

func TestPairingCodeExpiryAndAuthorization(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	expired := "expired-code"
	if _, err := persistent.CreatePairingCode(ctx, store.PairingCode{
		CodeHash:  store.HashToken(expired),
		CreatedAt: now.Add(-time.Hour),
		ExpiresAt: now.Add(-time.Minute),
	}); err != nil {
		t.Fatalf("create expired code: %v", err)
	}
	expiredDevice := store.DeviceRecord{
		Device: protocol.Device{DeviceID: "dev-expired", Status: "waiting_desktop_authorization", CreatedAt: now, UpdatedAt: now},
	}
	if err := persistent.BeginPairing(ctx, store.HashToken(expired), expiredDevice); !errors.Is(err, store.ErrPairingCodeExpired) {
		t.Fatalf("expired BeginPairing error=%v; want ErrPairingCodeExpired", err)
	}

	code := "good-code"
	if _, err := persistent.CreatePairingCode(ctx, store.PairingCode{
		CodeHash:  store.HashToken(code),
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}); err != nil {
		t.Fatalf("create pairing code: %v", err)
	}
	pairingToken := "pairing-token"
	challengeExpiry := now.Add(5 * time.Minute)
	record := store.DeviceRecord{
		Device: protocol.Device{
			DeviceID:    "dev-good",
			DeviceName:  "Test Desktop",
			Fingerprint: "SHA256:ABC",
			Status:      "waiting_desktop_authorization",
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		PairingTokenHash: store.HashToken(pairingToken),
		PairingExpiresAt: &challengeExpiry,
	}
	if err := persistent.BeginPairing(ctx, store.HashToken(code), record); err != nil {
		t.Fatalf("BeginPairing: %v", err)
	}

	// A mismatched pairing token must not authorize the device.
	if _, err := persistent.AuthorizePairing(
		ctx, "dev-good", store.HashToken("wrong-token"), store.HashToken("device-token"),
		[]protocol.Workspace{{ID: "ws-1", Name: "Workspace", Path: "/tmp/ws"}}, []string{"read"}, now,
	); !errors.Is(err, store.ErrPairingChallengeInvalid) {
		t.Fatalf("mismatched AuthorizePairing error=%v; want ErrPairingChallengeInvalid", err)
	}

	authorized, err := persistent.AuthorizePairing(
		ctx, "dev-good", store.HashToken(pairingToken), store.HashToken("device-token"),
		[]protocol.Workspace{{ID: "ws-1", Name: "Workspace", Path: "/tmp/ws"}}, []string{"read", "prompt"}, now,
	)
	if err != nil {
		t.Fatalf("AuthorizePairing: %v", err)
	}
	if authorized.Device.Status != "online" || len(authorized.Device.Scopes) != 2 {
		t.Fatalf("authorized device=%+v", authorized.Device)
	}
	if authorized.PairingTokenHash != "" {
		t.Fatalf("pairing token hash should be cleared, got %q", authorized.PairingTokenHash)
	}
	if len(authorized.Device.Workspaces) != 1 || authorized.Device.Workspaces[0].ID != "ws-1" {
		t.Fatalf("workspaces not persisted: %+v", authorized.Device.Workspaces)
	}

	// Replaying the authorization must fail: the device left the waiting state.
	if _, err := persistent.AuthorizePairing(
		ctx, "dev-good", store.HashToken(pairingToken), store.HashToken("other-token"),
		nil, []string{"read"}, now,
	); !errors.Is(err, store.ErrPairingAlreadyCompleted) {
		t.Fatalf("replayed AuthorizePairing error=%v; want ErrPairingAlreadyCompleted", err)
	}

	authenticated, err := persistent.AuthenticateDevice(ctx, store.HashToken("device-token"), now)
	if err != nil {
		t.Fatalf("AuthenticateDevice: %v", err)
	}
	if authenticated.Device.DeviceID != "dev-good" {
		t.Fatalf("authenticated device=%+v", authenticated.Device)
	}
	if _, err := persistent.AuthenticateDevice(ctx, store.HashToken("unknown-token"), now); !errors.Is(err, store.ErrDeviceNotFound) {
		t.Fatalf("unknown token error=%v; want ErrDeviceNotFound", err)
	}
}

func TestDeviceStatusAndListing(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	for _, id := range []string{"dev-b", "dev-a"} {
		record := store.DeviceRecord{
			Device: protocol.Device{
				DeviceID:    id,
				DeviceName:  "Desktop " + id,
				Fingerprint: "SHA256:" + id,
				Status:      "online",
				CreatedAt:   now,
				UpdatedAt:   now,
			},
		}
		if err := persistent.CreateDevice(ctx, record); err != nil {
			t.Fatalf("seed device %s: %v", id, err)
		}
	}

	devices, err := persistent.Devices(ctx)
	if err != nil {
		t.Fatalf("Devices: %v", err)
	}
	if len(devices) != 2 || devices[0].Device.DeviceID != "dev-a" || devices[1].Device.DeviceID != "dev-b" {
		t.Fatalf("devices not sorted by id: %+v", devices)
	}

	if err := persistent.SetAllOffline(ctx, now); err != nil {
		t.Fatalf("SetAllOffline: %v", err)
	}
	for _, record := range mustDevices(t, persistent) {
		if record.Device.Status != "offline" {
			t.Fatalf("device %s status=%q; want offline", record.Device.DeviceID, record.Device.Status)
		}
	}

	if err := persistent.SetDeviceStatus(ctx, "dev-a", "online", now); err != nil {
		t.Fatalf("SetDeviceStatus: %v", err)
	}
	updated, err := persistent.Device(ctx, "dev-a")
	if err != nil {
		t.Fatalf("Device: %v", err)
	}
	if updated.Device.Status != "online" || updated.Device.LastSeenAt == nil {
		t.Fatalf("device not marked online: %+v", updated.Device)
	}
	if err := persistent.SetDeviceStatus(ctx, "dev-missing", "online", now); !errors.Is(err, store.ErrDeviceNotFound) {
		t.Fatalf("missing device error=%v; want ErrDeviceNotFound", err)
	}
}

func TestMobileRefreshRotationHasSingleWinner(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	if _, err := persistent.CreateUser(ctx, "usr_mobile", "mobile@example.com", "Mobile", "member-password", store.RoleMember); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	code := "MOBILE-CODE"
	if err := persistent.CreateMobilePairingCode(ctx, store.MobilePairingCode{
		CodeHash:  store.HashToken(code),
		UserID:    "usr_mobile",
		CreatedAt: now,
		ExpiresAt: now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("CreateMobilePairingCode: %v", err)
	}
	paired, _, err := persistent.RedeemMobilePairingCode(ctx, store.HashToken(code), store.MobileDeviceRecord{
		Device: protocol.MobileDevice{
			MobileDeviceID: "mob-store-1",
			DeviceName:     "Store Phone",
			Platform:       "ios",
			AppVersion:     "0.1.0",
			CreatedAt:      now,
			UpdatedAt:      now,
		},
	}, store.MobileCredential{
		AccessTokenHash:  store.HashToken("access-initial"),
		RefreshTokenHash: store.HashToken("refresh-initial"),
		AccessExpiresAt:  now.Add(time.Minute),
		RefreshExpiresAt: now.Add(time.Hour),
	}, now)
	if err != nil {
		t.Fatalf("RedeemMobilePairingCode: %v", err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	for index := 1; index <= 2; index++ {
		index := index
		go func() {
			<-start
			_, _, rotationError := persistent.RotateMobileRefresh(ctx, paired.RefreshTokenHash, store.MobileCredential{
				AccessTokenHash:  store.HashToken(fmt.Sprintf("access-after-%d", index)),
				RefreshTokenHash: store.HashToken(fmt.Sprintf("refresh-after-%d", index)),
				AccessExpiresAt:  now.Add(2 * time.Minute),
				RefreshExpiresAt: now.Add(2 * time.Hour),
			}, now)
			results <- rotationError
		}()
	}
	close(start)
	successes, invalid := 0, 0
	for index := 0; index < 2; index++ {
		err := <-results
		switch {
		case err == nil:
			successes++
		case errors.Is(err, store.ErrMobileSessionInvalid):
			invalid++
		default:
			t.Fatalf("unexpected concurrent refresh error: %v", err)
		}
	}
	if successes != 1 || invalid != 1 {
		t.Fatalf("concurrent refresh successes=%d invalid=%d; want 1/1", successes, invalid)
	}
}

func mustDevices(t *testing.T, persistent *store.Store) []store.DeviceRecord {
	t.Helper()
	devices, err := persistent.Devices(context.Background())
	if err != nil {
		t.Fatalf("Devices: %v", err)
	}
	return devices
}

func TestAuditListingFiltersAndPaginates(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	base := time.Now().UTC().Add(-time.Hour).Truncate(time.Millisecond)

	entries := []store.AuditEntry{
		{OccurredAt: base, Actor: "bootstrap", Action: "pairing_code.create", Result: "success", Details: json.RawMessage(`{"before":null,"after":{"revision":1}}`)},
		{OccurredAt: base.Add(time.Minute), Actor: "connector", Action: "pair.start", DeviceID: "dev-1", Result: "success"},
		{OccurredAt: base.Add(2 * time.Minute), Actor: "connector", Action: "pair.start", DeviceID: "dev-2", Result: "error", ErrorCode: "pairing_code_invalid"},
	}
	for _, entry := range entries {
		if err := persistent.AppendAudit(ctx, entry); err != nil {
			t.Fatalf("AppendAudit: %v", err)
		}
	}

	all, total, err := persistent.Audit(ctx, store.AuditQuery{Limit: 10})
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if total != 3 || len(all) != 3 {
		t.Fatalf("audit total=%d len=%d; want 3/3", total, len(all))
	}
	// Newest first.
	if all[0].DeviceID != "dev-2" {
		t.Fatalf("audit not newest-first: %+v", all[0])
	}
	if !bytes.Contains(all[2].Details, []byte(`"revision":1`)) {
		t.Fatalf("audit details were not preserved: %+v", all[2])
	}

	filtered, filteredTotal, err := persistent.Audit(ctx, store.AuditQuery{Result: "error", Limit: 10})
	if err != nil {
		t.Fatalf("Audit filtered: %v", err)
	}
	if filteredTotal != 1 || len(filtered) != 1 || filtered[0].ErrorCode != "pairing_code_invalid" {
		t.Fatalf("filtered audit=%+v total=%d", filtered, filteredTotal)
	}

	paged, pagedTotal, err := persistent.Audit(ctx, store.AuditQuery{Limit: 1, Offset: 1})
	if err != nil {
		t.Fatalf("Audit paged: %v", err)
	}
	if pagedTotal != 3 || len(paged) != 1 || paged[0].DeviceID != "dev-1" {
		t.Fatalf("paged audit=%+v total=%d", paged, pagedTotal)
	}
}

func TestAttachmentFailureSurvivesTranscriptRefresh(t *testing.T) {
	persistent := newStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	declaration := store.SessionAttachmentRecord{
		ID: "att_retryable_failure", DeviceID: "dev-1", SessionID: "sess-1", WorkspaceID: "ws-1",
		Source: protocol.AttachmentSourceDeliverable, Kind: "image", DisplayName: "image.png",
		Mime: "image/png", Bytes: 128, State: protocol.AttachmentStateKnown, ExpiresAt: now.Add(time.Hour),
	}
	if err := persistent.UpsertSessionAttachments(ctx, []store.SessionAttachmentRecord{declaration}, now); err != nil {
		t.Fatalf("learn attachment: %v", err)
	}
	won, err := persistent.BeginAttachmentFetch(ctx, declaration.ID, now)
	if err != nil || !won {
		t.Fatalf("begin attachment fetch won=%v err=%v", won, err)
	}
	if err := persistent.FailAttachmentIfFetching(ctx, declaration.ID, protocol.AttachmentErrorFailed, now); err != nil {
		t.Fatalf("fail attachment fetch: %v", err)
	}

	// Polling the same declaration must not erase the failure and create an
	// endless known -> fetching -> failed loop without showing the real error.
	if err := persistent.UpsertSessionAttachments(ctx, []store.SessionAttachmentRecord{declaration}, now.Add(time.Second)); err != nil {
		t.Fatalf("refresh attachment declaration: %v", err)
	}
	failed, err := persistent.SessionAttachment(ctx, declaration.ID)
	if err != nil {
		t.Fatalf("load failed attachment: %v", err)
	}
	if failed.State != protocol.AttachmentStateFailed || failed.ErrorCode != protocol.AttachmentErrorFailed {
		t.Fatalf("failed verdict was reset by transcript: %+v", failed)
	}

	// A real download request remains the explicit retry boundary.
	won, err = persistent.BeginAttachmentFetch(ctx, declaration.ID, now.Add(2*time.Second))
	if err != nil || !won {
		t.Fatalf("retry failed attachment won=%v err=%v", won, err)
	}
	if err := persistent.UpsertSessionAttachments(ctx, []store.SessionAttachmentRecord{declaration}, now.Add(3*time.Second)); err != nil {
		t.Fatalf("refresh in-flight attachment: %v", err)
	}
	retrying, err := persistent.SessionAttachment(ctx, declaration.ID)
	if err != nil {
		t.Fatalf("load retrying attachment: %v", err)
	}
	if retrying.State != protocol.AttachmentStateFetching {
		t.Fatalf("in-flight retry regressed to another state: %+v", retrying)
	}
}
