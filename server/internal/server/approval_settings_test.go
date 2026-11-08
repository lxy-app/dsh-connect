package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

func TestInteractionStoreSetTTLNarrowsExistingItems(t *testing.T) {
	interactions := NewInteractionStore(10 * time.Minute)
	now := nowUTC()
	created := now.Add(-20 * time.Second)
	interactions.Put("dev-1", protocol.InteractionRequestData{
		InteractionID: "int-ttl-fresh", Kind: protocol.InteractionKindApproval,
		SessionID: "sess-1", WorkspaceID: "ws-1", Title: "fresh",
		CreatedAt: created, ExpiresAt: now.Add(5 * time.Minute),
	}, now)
	interactions.Put("dev-1", protocol.InteractionRequestData{
		InteractionID: "int-ttl-expired", Kind: protocol.InteractionKindApproval,
		SessionID: "sess-1", WorkspaceID: "ws-1", Title: "expired",
		CreatedAt: now.Add(-time.Minute), ExpiresAt: now.Add(5 * time.Minute),
	}, now)
	interactions.Put("dev-1", protocol.InteractionRequestData{
		InteractionID: "int-ttl-earlier", Kind: protocol.InteractionKindApproval,
		SessionID: "sess-1", WorkspaceID: "ws-1", Title: "earlier",
		CreatedAt: created, ExpiresAt: now.Add(5 * time.Second),
	}, now)

	interactions.SetTTL(30*time.Second, now)
	listed := interactions.list(now)
	if len(listed) != 2 {
		t.Fatalf("SetTTL left %d items; want fresh and earlier only: %+v", len(listed), listed)
	}
	byID := make(map[string]protocol.InteractionRequestData, len(listed))
	for _, item := range listed {
		byID[item.InteractionID] = item
	}
	if got := byID["int-ttl-fresh"].ExpiresAt; !got.Equal(created.Add(30 * time.Second)) {
		t.Fatalf("fresh expiresAt=%s; want createdAt+30s=%s", got, created.Add(30*time.Second))
	}
	if got := byID["int-ttl-earlier"].ExpiresAt; !got.Equal(now.Add(5 * time.Second)) {
		t.Fatalf("earlier expiry was extended to %s", got)
	}

	interactions.Put("dev-1", protocol.InteractionRequestData{
		InteractionID: "int-ttl-new", Kind: protocol.InteractionKindApproval,
		SessionID: "sess-1", WorkspaceID: "ws-1", Title: "new",
		CreatedAt: now, ExpiresAt: now.Add(5 * time.Minute),
	}, now)
	listed = interactions.list(now)
	for _, item := range listed {
		if item.InteractionID == "int-ttl-new" && !item.ExpiresAt.Equal(now.Add(30*time.Second)) {
			t.Fatalf("new item expiresAt=%s; want now+30s", item.ExpiresAt)
		}
	}
}

func TestInteractionStoreConcurrentTTLAndPut(t *testing.T) {
	interactions := NewInteractionStore(10 * time.Minute)
	now := nowUTC()
	var workers sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		worker := worker
		workers.Add(1)
		go func() {
			defer workers.Done()
			for iteration := 0; iteration < 100; iteration++ {
				interactions.Put("dev-1", protocol.InteractionRequestData{
					InteractionID: fmt.Sprintf("int-race-%d", worker), Kind: protocol.InteractionKindApproval,
					SessionID: "sess-1", WorkspaceID: "ws-1", Title: "race",
					CreatedAt: now, ExpiresAt: now.Add(10 * time.Minute),
				}, now)
			}
		}()
	}
	for _, ttl := range []time.Duration{30 * time.Second, 10 * time.Minute} {
		ttl := ttl
		workers.Add(1)
		go func() {
			defer workers.Done()
			for iteration := 0; iteration < 100; iteration++ {
				interactions.SetTTL(ttl, now)
				interactions.list(now)
			}
		}()
	}
	workers.Wait()
	interactions.SetEnabled(true)
	if got := len(interactions.list(now)); got != 4 {
		t.Fatalf("concurrent Put/SetTTL left %d items; want 4", got)
	}
}

func TestRemoteApprovalDisabledFullChain(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnectorWithScopes(t, environment.testEnvironment, []string{"read", "approve"})
	phone := pairMobile(t, environment, issueMobilePairingCode(t, environment, ownerToken, "").Code, "Policy iPhone")
	approveMobileAccess(t, environment, connector, phone, []string{"read", "approve"})

	audience := func() bool {
		t.Helper()
		raw := connectorRequest(t, connector.connection, protocol.ConnectorMethodInteractionAudience, map[string]any{"workspaceId": "ws-1"})
		var response protocol.InteractionAudienceResponse
		if err := json.Unmarshal(raw, &response); err != nil {
			t.Fatal(err)
		}
		return response.Watching
	}
	listInteractions(t, environment, phone)
	if !audience() {
		t.Fatal("enabled phone poll should create an interaction audience")
	}
	now := nowUTC()
	writeTestFrame(t, connector.connection, interactionEvent(t, connector.deviceID, "sess-1", protocol.InteractionRequestData{
		InteractionID: "int-before-disable", Kind: protocol.InteractionKindApproval,
		SessionID: "sess-1", WorkspaceID: "ws-1", WorkspaceName: "Project", Title: "before",
		CreatedAt: now, ExpiresAt: now.Add(time.Minute),
	}))
	waitForInteractions(t, environment, phone, 1)

	status, body := testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/approval-policy", ownerToken, map[string]any{
		"revision": 1, "remoteEnabled": false,
	})
	if status != http.StatusOK {
		t.Fatalf("disable policy status=%d body=%s", status, body)
	}
	var disabled store.ApprovalPolicyRecord
	decodeTestJSON(t, body, &disabled)
	if disabled.RemoteEnabled || disabled.Revision != 2 || disabled.TTLSeconds != 600 {
		t.Fatalf("disabled policy=%+v", disabled)
	}
	if pending := listInteractions(t, environment, phone); len(pending.Interactions) != 0 {
		t.Fatalf("disabled mobile list=%+v; want empty", pending.Interactions)
	}
	environment.server.interactions.mu.Lock()
	_, sawPoll := environment.server.interactions.lastPoll[phone.MobileDeviceID]
	environment.server.interactions.mu.Unlock()
	if sawPoll {
		t.Fatal("disabled mobile list recorded SawPoll or retained stale presence")
	}
	if audience() {
		t.Fatal("disabled policy must force Connector audience false")
	}
	status, body = testRequest(t, http.MethodPost,
		environment.http.URL+"/v1/mobile/interactions/int-before-disable/decision", phone.AccessToken,
		map[string]any{"requestId": "decision-disabled", "decision": "allow-once"})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	// The following audience RPC is ordered after this event on the Connector
	// socket, proving the disabled request was ingested and discarded.
	writeTestFrame(t, connector.connection, interactionEvent(t, connector.deviceID, "sess-1", protocol.InteractionRequestData{
		InteractionID: "int-while-disabled", Kind: protocol.InteractionKindApproval,
		SessionID: "sess-1", WorkspaceID: "ws-1", WorkspaceName: "Project", Title: "disabled",
		CreatedAt: nowUTC(), ExpiresAt: nowUTC().Add(time.Minute),
	}))
	if audience() {
		t.Fatal("disabled request unexpectedly created an audience")
	}
	if pending := environment.server.interactions.list(nowUTC()); len(pending) != 0 {
		t.Fatalf("disabled interaction entered pending: %+v", pending)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/interactions", ownerToken, nil)
	if status != http.StatusOK || string(body) != "{\"interactions\":[]}\n" {
		t.Fatalf("disabled Admin interactions status=%d body=%s", status, body)
	}

	status, body = testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/approval-policy", ownerToken, map[string]any{
		"revision": 2, "remoteEnabled": true,
	})
	if status != http.StatusOK {
		t.Fatalf("re-enable policy status=%d body=%s", status, body)
	}
	if audience() {
		t.Fatal("re-enabling must not resurrect pre-disable or disabled-list polling presence")
	}
	listInteractions(t, environment, phone)
	if !audience() {
		t.Fatal("a fresh post-enable mobile poll should restore the audience")
	}
}

func TestAdminInteractionDetailAndReadOnlyRoute(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	now := nowUTC()
	environment.server.interactions.Put(connector.deviceID, protocol.InteractionRequestData{
		InteractionID: "int-admin-question", Kind: protocol.InteractionKindQuestion,
		SessionID: "sess-admin", WorkspaceID: "ws-1", WorkspaceName: "Project",
		Title: "Choose a path", ToolName: "ask_user", Reason: "Need operator context", CallID: "call-123",
		Questions: []protocol.InteractionQuestion{{
			ID: "q1", Question: "Continue?", Detail: "Review the complete context",
			Options: []protocol.InteractionQuestionOption{{Label: "Yes", Description: "Continue once"}},
		}},
		CreatedAt: now, ExpiresAt: now.Add(time.Minute),
	}, now)
	environment.server.interactions.Put(connector.deviceID, protocol.InteractionRequestData{
		InteractionID: "int-admin-approval", Kind: protocol.InteractionKindApproval,
		SessionID: "sess-admin", WorkspaceID: "ws-1", WorkspaceName: "Project", Title: "Run bash",
		CreatedAt: now.Add(time.Second), ExpiresAt: now.Add(time.Minute),
	}, now)

	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/interactions", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("Admin interactions status=%d body=%s", status, body)
	}
	var response adminInteractionListResponse
	decodeTestJSON(t, body, &response)
	if len(response.Interactions) != 2 {
		t.Fatalf("Admin interactions=%+v; want two", response.Interactions)
	}
	detail := response.Interactions[0]
	if detail.InteractionID != "int-admin-question" || detail.CallID != "call-123" || detail.Reason != "Need operator context" ||
		detail.DeviceName != "Integration Desktop" || detail.WorkspaceName != "Project" || len(detail.Questions) != 1 {
		t.Fatalf("incomplete Admin interaction detail: %+v", detail)
	}
	if response.Interactions[1].Questions == nil {
		t.Fatal("approval questions must be an empty array, not null")
	}
	var raw struct {
		Interactions []map[string]json.RawMessage `json:"interactions"`
	}
	decodeTestJSON(t, body, &raw)
	for _, interaction := range raw.Interactions {
		assertExactJSONFields(t, interaction,
			"interactionId", "kind", "title", "toolName", "reason", "callId", "questions",
			"deviceId", "deviceName", "sessionId", "workspaceId", "workspaceName", "createdAt", "expiresAt",
		)
	}
	if bytes.Contains(body, []byte("/tmp/project")) || bytes.Contains(body, []byte("callID")) {
		t.Fatalf("Admin interaction leaked a path or used the wrong callId spelling: %s", body)
	}
	status, _ = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/interactions/int-admin-question/decision", ownerToken, map[string]any{"decision": "allow-once"})
	if status != http.StatusNotFound {
		t.Fatalf("Admin decision endpoint status=%d; want not found", status)
	}
}

func TestAdminApprovalPolicyValidationAndRevision(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	url := environment.http.URL + "/v1/admin/approval-policy"

	status, body := testRequest(t, http.MethodGet, url, ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("GET approval policy status=%d body=%s", status, body)
	}
	var raw map[string]json.RawMessage
	decodeTestJSON(t, body, &raw)
	assertExactJSONFields(t, raw, "remoteEnabled", "ttlSeconds", "revision", "createdAt", "updatedAt")
	var policy store.ApprovalPolicyRecord
	decodeTestJSON(t, body, &policy)
	if !policy.RemoteEnabled || policy.TTLSeconds != 600 || policy.Revision != 1 {
		t.Fatalf("default approval policy=%+v", policy)
	}

	for _, payload := range []map[string]any{
		{"remoteEnabled": false},
		{"revision": 1, "ttlSeconds": 29},
		{"revision": 1, "ttlSeconds": 601},
		{"revision": 1, "unknown": true},
	} {
		status, body = testRequest(t, http.MethodPatch, url, ownerToken, payload)
		assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)
	}
	status, body = testRequest(t, http.MethodPatch, url, ownerToken, map[string]any{"revision": 2, "remoteEnabled": false})
	assertErrorResponse(t, status, body, http.StatusConflict, protocol.CodeConflict)

	status, body = testRequest(t, http.MethodPatch, url, ownerToken, map[string]any{"revision": 1, "ttlSeconds": 60})
	if status != http.StatusOK {
		t.Fatalf("valid policy update status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &policy)
	if !policy.RemoteEnabled || policy.TTLSeconds != 60 || policy.Revision != 2 {
		t.Fatalf("updated approval policy=%+v", policy)
	}
	status, body = testRequest(t, http.MethodPatch, url, ownerToken, map[string]any{"revision": 1, "remoteEnabled": false})
	assertErrorResponse(t, status, body, http.StatusConflict, protocol.CodeConflict)
	status, body = testRequest(t, http.MethodGet, url, ownerToken, nil)
	decodeTestJSON(t, body, &policy)
	if !policy.RemoteEnabled || policy.TTLSeconds != 60 || policy.Revision != 2 {
		t.Fatalf("stale update changed policy=%+v", policy)
	}
}

func TestAdminApprovalInteractionAndSettingsRoles(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	tokens := map[string]string{store.RoleOwner: ownerToken}
	for _, role := range []string{store.RoleAdmin, store.RoleAuditor, store.RoleMember} {
		email := role + "-m4@example.com"
		password := role + "-password"
		status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]any{
			"email": email, "displayName": role, "password": password, "role": role,
		})
		if status != http.StatusCreated {
			t.Fatalf("create %s status=%d body=%s", role, status, body)
		}
		tokens[role], _ = environment.login(t, email, password)
	}

	for _, role := range []string{store.RoleOwner, store.RoleAdmin, store.RoleAuditor} {
		for _, path := range []string{"/v1/admin/interactions", "/v1/admin/approval-policy"} {
			status, body := testRequest(t, http.MethodGet, environment.http.URL+path, tokens[role], nil)
			if status != http.StatusOK {
				t.Fatalf("%s GET %s status=%d body=%s", role, path, status, body)
			}
		}
	}
	for _, path := range []string{"/v1/admin/interactions", "/v1/admin/approval-policy", "/v1/admin/settings"} {
		status, body := testRequest(t, http.MethodGet, environment.http.URL+path, tokens[store.RoleMember], nil)
		assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
	}
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/settings", tokens[store.RoleAuditor], nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
	for _, role := range []string{store.RoleOwner, store.RoleAdmin} {
		status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/settings", tokens[role], nil)
		if status != http.StatusOK {
			t.Fatalf("%s settings status=%d body=%s", role, status, body)
		}
	}

	status, body = testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/approval-policy", tokens[store.RoleAdmin], map[string]any{
		"revision": 1, "ttlSeconds": 300,
	})
	if status != http.StatusOK {
		t.Fatalf("admin PATCH approval policy status=%d body=%s", status, body)
	}
	for _, role := range []string{store.RoleAuditor, store.RoleMember} {
		status, body = testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/approval-policy", tokens[role], map[string]any{
			"revision": 2, "remoteEnabled": false,
		})
		assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/approval-policy", "", nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
}

func TestAdminApprovalPolicyTTLUpdateNarrowsPending(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	now := nowUTC()
	created := now.Add(-20 * time.Second)
	for _, item := range []protocol.InteractionRequestData{
		{InteractionID: "int-policy-fresh", CreatedAt: created},
		{InteractionID: "int-policy-expired", CreatedAt: now.Add(-time.Minute)},
	} {
		item.Kind = protocol.InteractionKindApproval
		item.SessionID = "sess-1"
		item.WorkspaceID = "ws-1"
		item.Title = item.InteractionID
		item.ExpiresAt = now.Add(5 * time.Minute)
		environment.server.interactions.Put(connector.deviceID, item, now)
	}
	status, body := testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/approval-policy", ownerToken, map[string]any{
		"revision": 1, "ttlSeconds": 30,
	})
	if status != http.StatusOK {
		t.Fatalf("TTL update status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/interactions", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("list after TTL update status=%d body=%s", status, body)
	}
	var response adminInteractionListResponse
	decodeTestJSON(t, body, &response)
	if len(response.Interactions) != 1 || response.Interactions[0].InteractionID != "int-policy-fresh" {
		t.Fatalf("pending after TTL update=%+v", response.Interactions)
	}
	if got := response.Interactions[0].ExpiresAt; !got.Equal(created.Add(30 * time.Second)) {
		t.Fatalf("expiresAt after TTL update=%s; want %s", got, created.Add(30*time.Second))
	}
}

func TestAdminRuntimeSettingsAreExactAndNonSecret(t *testing.T) {
	environment := newTestEnvironment(t, func(config *Config) {
		config.ServerURL = "https://settings.example.test"
		config.PairingCodeTTL = 11 * time.Minute
		config.MobileAccessTokenTTL = 17 * time.Minute
		config.AdminSessionTTL = 13 * time.Hour
		config.CommandTimeout = 23 * time.Second
		config.AttachmentsMode = attachmentsModeReadWrite
		config.MaxAttachmentBytes = 123456
		config.MaxAttachmentStoreBytes = 1234567
		config.AttachmentTTL = 49 * time.Hour
		config.AttachmentDir = "/private/attachment/path"
	})
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/settings", testBootstrapToken, nil)
	if status != http.StatusOK {
		t.Fatalf("settings status=%d body=%s", status, body)
	}
	var raw map[string]json.RawMessage
	decodeTestJSON(t, body, &raw)
	assertExactJSONFields(t, raw,
		"serverUrl", "pairingCodeTTLSeconds", "mobileAccessTokenTTLSeconds", "adminSessionTTLSeconds",
		"commandTimeoutSeconds", "attachmentsMode", "maxAttachmentBytes", "attachmentTTLSeconds",
		"goVersion", "databaseDialect", "databaseConnected", "generatedAt",
	)
	var settings adminRuntimeSettings
	decodeTestJSON(t, body, &settings)
	if settings.ServerURL != "https://settings.example.test" || settings.PairingCodeTTLSeconds != 660 ||
		settings.MobileAccessTokenTTLSeconds != 1020 || settings.AdminSessionTTLSeconds != 46800 ||
		settings.CommandTimeoutSeconds != 23 || settings.AttachmentsMode != attachmentsModeReadWrite ||
		settings.MaxAttachmentBytes != 123456 || settings.AttachmentTTLSeconds != 176400 {
		t.Fatalf("runtime settings=%+v", settings)
	}
	if settings.GoVersion == "" || settings.DatabaseDialect == "" || !settings.DatabaseConnected || settings.GeneratedAt.IsZero() {
		t.Fatalf("runtime health metadata=%+v", settings)
	}
	for _, secret := range []string{testBootstrapToken, environment.databaseURL, "/private/attachment/path", "BootstrapOwnerPassword", "APNs", "FCM"} {
		if bytes.Contains(body, []byte(secret)) {
			t.Fatalf("settings leaked %q: %s", secret, body)
		}
	}

	// Bootstrap bearer authentication does not need a DB session lookup, so a
	// closed Store proves databaseConnected comes from a real Ping rather than a constant.
	if err := environment.server.store.Close(); err != nil {
		t.Fatalf("close Store fixture: %v", err)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/settings", testBootstrapToken, nil)
	if status != http.StatusOK {
		t.Fatalf("settings after DB close status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &settings)
	if settings.DatabaseConnected {
		t.Fatalf("closed database reported connected: %+v", settings)
	}
}

func TestServerLoadsPersistedApprovalPolicy(t *testing.T) {
	environment := newTestEnvironment(t)
	enabled := false
	ttl := 60
	if _, err := environment.server.store.UpdateApprovalPolicy(context.Background(), 1, store.ApprovalPolicyUpdate{
		RemoteEnabled: &enabled, TTLSeconds: &ttl,
	}); err != nil {
		t.Fatalf("seed approval policy: %v", err)
	}
	restarted, err := New(context.Background(), Config{
		BootstrapToken: testBootstrapToken,
		DatabaseURL:    environment.databaseURL,
		ServerURL:      "http://server.test",
	})
	if err != nil {
		t.Fatalf("restart New: %v", err)
	}
	defer restarted.Close()
	if restarted.interactions.RemoteEnabled() {
		t.Fatal("Server.New did not load remoteEnabled=false")
	}
	restarted.interactions.mu.Lock()
	loadedTTL := restarted.interactions.ttl
	restarted.interactions.mu.Unlock()
	if loadedTTL != time.Minute {
		t.Fatalf("Server.New loaded TTL=%s; want 1m", loadedTTL)
	}
}
