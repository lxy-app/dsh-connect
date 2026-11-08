package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

func respondWithAdminSessions(connector pairedConnector, sessions []map[string]any) <-chan error {
	result := make(chan error, 1)
	go func() {
		result <- answerCommand(connector.connection, protocol.MethodSessionList, map[string]any{"sessions": sessions})
	}()
	return result
}

func assertExactJSONFields(t *testing.T, object map[string]json.RawMessage, fields ...string) {
	t.Helper()
	if len(object) != len(fields) {
		t.Fatalf("JSON fields=%v; want exactly %v", object, fields)
	}
	for _, field := range fields {
		if _, ok := object[field]; !ok {
			t.Fatalf("JSON object is missing %q: %v", field, object)
		}
	}
}

func TestAdminSessionsAggregateRealConnectors(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	first := pairConnector(t, environment.testEnvironment)
	second := pairConnector(t, environment.testEnvironment)
	ctx := context.Background()
	now := nowUTC()
	if err := environment.server.store.RenameDevice(ctx, first.deviceID, "Alpha Desktop", now); err != nil {
		t.Fatalf("rename first desktop: %v", err)
	}
	if err := environment.server.store.RenameDevice(ctx, second.deviceID, "Beta Desktop", now); err != nil {
		t.Fatalf("rename second desktop: %v", err)
	}
	if err := environment.server.store.CreateDevice(ctx, store.DeviceRecord{Device: protocol.Device{
		DeviceID: "dev-admin-offline", DeviceName: "Offline Desktop", Status: "offline",
		Workspaces: []protocol.Workspace{{ID: "ws-1", Name: "Project", Path: "/tmp/offline-secret"}},
		Scopes:     []string{"read"}, CreatedAt: now, UpdatedAt: now,
	}}); err != nil {
		t.Fatalf("seed offline desktop: %v", err)
	}

	older := now.Add(-time.Hour).Truncate(time.Millisecond)
	newer := older.Add(time.Minute)
	firstAnswer := respondWithAdminSessions(first, []map[string]any{
		{
			"id": "sess-running", "title": "", "workspaceId": "ws-1", "status": "running", "updatedAt": older,
			"path": "/private/session/path", "messages": []map[string]any{{"text": "private transcript"}},
		},
		{"sessionId": "sess-unknown-workspace", "workspaceId": "ws-unknown", "status": "idle", "updatedAt": now},
		{"sessionId": "sess-invalid-status", "workspaceId": "ws-1", "status": "archived", "updatedAt": now},
	})
	secondAnswer := respondWithAdminSessions(second, []map[string]any{
		{
			"sessionId": "sess-idle", "title": "Newest session", "workspaceId": "ws-1", "status": "idle", "updatedAt": newer,
			"content": "private prompt body", "workspacePath": "/another/private/path",
		},
	})
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/sessions", ownerToken, nil)
	if err := <-firstAnswer; err != nil {
		t.Fatalf("first Connector answer: %v", err)
	}
	if err := <-secondAnswer; err != nil {
		t.Fatalf("second Connector answer: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("admin sessions status=%d body=%s", status, body)
	}
	var response adminSessionListResponse
	decodeTestJSON(t, body, &response)
	if len(response.Sessions) != 2 {
		t.Fatalf("admin sessions=%+v; want two valid sessions", response.Sessions)
	}
	if response.Sessions[0].SessionID != "sess-idle" || response.Sessions[1].SessionID != "sess-running" {
		t.Fatalf("sessions not sorted by updatedAt descending: %+v", response.Sessions)
	}
	if response.Sessions[0].DeviceName != "Beta Desktop" || response.Sessions[0].WorkspaceName != "Project" || response.Sessions[0].Status != "idle" {
		t.Fatalf("unexpected newest session projection: %+v", response.Sessions[0])
	}
	if response.Sessions[1].Title != "sess-running" || response.Sessions[1].DeviceName != "Alpha Desktop" || response.Sessions[1].Status != "running" {
		t.Fatalf("unexpected running session projection: %+v", response.Sessions[1])
	}
	if len(response.Warnings) != 1 || response.Warnings[0].DeviceID != "dev-admin-offline" || response.Warnings[0].Code != protocol.CodeDeviceOffline {
		t.Fatalf("offline desktop warnings=%+v", response.Warnings)
	}
	for _, secret := range []string{"private transcript", "private prompt body", "/private/session/path", "/another/private/path", "/tmp/project"} {
		if bytes.Contains(body, []byte(secret)) {
			t.Fatalf("admin sessions leaked %q: %s", secret, body)
		}
	}
	var raw struct {
		Sessions []map[string]json.RawMessage `json:"sessions"`
	}
	decodeTestJSON(t, body, &raw)
	for _, session := range raw.Sessions {
		assertExactJSONFields(t, session,
			"sessionId", "title", "deviceId", "deviceName", "workspaceId", "workspaceName", "status", "updatedAt",
		)
	}
}

func TestAdminSessionsRoles(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	tokens := map[string]string{store.RoleOwner: ownerToken}
	for _, role := range []string{store.RoleAdmin, store.RoleAuditor, store.RoleMember} {
		email := role + "-sessions@example.com"
		password := role + "-password"
		status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
			"email": email, "displayName": role, "password": password, "role": role,
		})
		if status != http.StatusCreated {
			t.Fatalf("create %s status=%d body=%s", role, status, body)
		}
		token, _ := environment.login(t, email, password)
		tokens[role] = token
	}
	for _, role := range []string{store.RoleOwner, store.RoleAdmin, store.RoleAuditor} {
		status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/sessions", tokens[role], nil)
		if status != http.StatusOK || string(body) != "{\"sessions\":[],\"warnings\":[]}\n" {
			t.Fatalf("%s sessions status=%d body=%s", role, status, body)
		}
	}
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/sessions", tokens[store.RoleMember], nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/sessions", "", nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
}

func completeOperationCommand(t *testing.T, environment *adminEnvironment, requestID, method string, completedAt time.Time, commandError *protocol.Error) {
	t.Helper()
	record := store.IdempotencyRecord{
		RequestID: requestID, Method: method, DeviceID: "dev-operations", RequestHash: "hash-" + requestID,
		CreatedAt: completedAt.Add(-time.Second), CompletedAt: completedAt,
	}
	if commandError == nil {
		record.Result = json.RawMessage(`{"status":"accepted"}`)
	} else {
		record.Error = commandError
	}
	if err := environment.server.store.CompleteIdempotency(context.Background(), record); err != nil {
		t.Fatalf("CompleteIdempotency %s: %v", requestID, err)
	}
}

func TestAdminOverviewOperationsMetricsTrendAndPending(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	now := nowUTC()
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	localNow := now.In(location)
	today := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, location)
	completeOperationCommand(t, environment, "prompt-today-1", protocol.MethodSessionPrompt, today, nil)
	completeOperationCommand(t, environment, "prompt-today-2", protocol.MethodSessionPrompt, today, nil)
	completeOperationCommand(t, environment, "prompt-yesterday", protocol.MethodSessionPrompt, today.Add(-time.Hour), nil)
	completeOperationCommand(t, environment, "prompt-six-days-ago", protocol.MethodSessionPrompt, today.AddDate(0, 0, -6), nil)
	completeOperationCommand(t, environment, "prompt-too-old", protocol.MethodSessionPrompt, today.AddDate(0, 0, -7), nil)
	completeOperationCommand(t, environment, "prompt-future", protocol.MethodSessionPrompt, today.AddDate(0, 0, 1), nil)
	completeOperationCommand(t, environment, "prompt-failed", protocol.MethodSessionPrompt, today, &protocol.Error{Code: protocol.CodeCommandTimeout, Message: "timeout", Retryable: true})
	completeOperationCommand(t, environment, "session-create-not-prompt", protocol.MethodSessionCreate, today, nil)
	// Replaying a request id cannot create a second admission or trend point.
	duplicate := store.IdempotencyRecord{
		RequestID: "prompt-today-1", Method: protocol.MethodSessionPrompt, DeviceID: "dev-operations", RequestHash: "hash-prompt-today-1",
		CreatedAt: today, CompletedAt: today, Result: json.RawMessage(`{"status":"accepted"}`),
	}
	if err := environment.server.store.CompleteIdempotency(context.Background(), duplicate); !errors.Is(err, store.ErrIdempotencyExists) {
		t.Fatalf("duplicate prompt error=%v; want ErrIdempotencyExists", err)
	}

	for index := 0; index < 6; index++ {
		environment.server.interactions.Put(connector.deviceID, protocol.InteractionRequestData{
			InteractionID: fmt.Sprintf("int_admin_%d", index), Kind: protocol.InteractionKindApproval,
			SessionID: "sess-pending", WorkspaceID: "ws-1", Title: fmt.Sprintf("Approval %d", index), ToolName: "bash",
			Reason: "sensitive approval reason", Questions: []protocol.InteractionQuestion{{ID: "q", Question: "sensitive question"}},
			CreatedAt: now.Add(-time.Minute + time.Duration(index)*time.Second), ExpiresAt: now.Add(5 * time.Minute),
		}, now)
	}

	sessions := make([]map[string]any, 0, 6)
	for index := 0; index < 6; index++ {
		status := "idle"
		if index == 0 || index == 4 {
			status = "running"
		}
		sessions = append(sessions, map[string]any{
			"sessionId": fmt.Sprintf("sess-%d", index), "title": fmt.Sprintf("Session %d", index),
			"workspaceId": "ws-1", "status": status, "updatedAt": now.Add(time.Duration(index-5) * time.Minute),
		})
	}
	answer := respondWithAdminSessions(connector, sessions)
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/overview?tz=Asia/Shanghai", ownerToken, nil)
	if err := <-answer; err != nil {
		t.Fatalf("Connector answer: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("overview status=%d body=%s", status, body)
	}
	var overview overviewResponse
	decodeTestJSON(t, body, &overview)
	if overview.Devices["total"] != 1 || overview.Users["total"] != 1 || overview.Audit == 0 || len(overview.Recent) == 0 {
		t.Fatalf("existing overview fields regressed: %+v", overview)
	}
	if overview.ActiveSessions != 2 || overview.TodayPrompts != 2 {
		t.Fatalf("activeSessions=%d todayPrompts=%d; want 2/2", overview.ActiveSessions, overview.TodayPrompts)
	}
	if overview.PendingInteractions != 6 || len(overview.PendingRequests) != 5 {
		t.Fatalf("pendingInteractions=%d pendingRequests=%d; want 6/5", overview.PendingInteractions, len(overview.PendingRequests))
	}
	if len(overview.Sessions) != 5 || overview.Sessions[0].SessionID != "sess-5" || overview.Sessions[4].SessionID != "sess-1" {
		t.Fatalf("recent sessions should contain newest five: %+v", overview.Sessions)
	}
	if len(overview.Warnings) != 0 {
		t.Fatalf("unexpected overview warnings: %+v", overview.Warnings)
	}
	if len(overview.PromptTrend) != 7 {
		t.Fatalf("promptTrend=%+v; want seven days", overview.PromptTrend)
	}
	if overview.PromptTrend[0].Date != today.AddDate(0, 0, -6).Format("2006-01-02") || overview.PromptTrend[0].Count != 1 {
		t.Fatalf("first trend point=%+v", overview.PromptTrend[0])
	}
	if overview.PromptTrend[5].Date != today.Add(-time.Hour).Format("2006-01-02") || overview.PromptTrend[5].Count != 1 {
		t.Fatalf("yesterday trend point=%+v", overview.PromptTrend[5])
	}
	if overview.PromptTrend[6].Date != today.Format("2006-01-02") || overview.PromptTrend[6].Count != 2 {
		t.Fatalf("today trend point=%+v", overview.PromptTrend[6])
	}
	if overview.PendingRequests[0].InteractionID != "int_admin_0" || overview.PendingRequests[0].DeviceName != "Integration Desktop" {
		t.Fatalf("unexpected pending request projection: %+v", overview.PendingRequests[0])
	}
	if bytes.Contains(body, []byte("sensitive approval reason")) || bytes.Contains(body, []byte("sensitive question")) {
		t.Fatalf("overview leaked pending interaction payload: %s", body)
	}
	var raw struct {
		Sessions        []map[string]json.RawMessage `json:"sessions"`
		PendingRequests []map[string]json.RawMessage `json:"pendingRequests"`
	}
	decodeTestJSON(t, body, &raw)
	for _, session := range raw.Sessions {
		assertExactJSONFields(t, session,
			"sessionId", "title", "deviceId", "deviceName", "workspaceId", "workspaceName", "status", "updatedAt",
		)
	}
	for _, pending := range raw.PendingRequests {
		assertExactJSONFields(t, pending,
			"interactionId", "kind", "title", "toolName", "deviceId", "deviceName", "sessionId", "workspaceId", "createdAt", "expiresAt",
		)
	}

	// An invalid IANA zone fails before any Connector request is attempted.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/overview?tz=Not%2FAZone", ownerToken, nil)
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)

	// Omitting tz keeps the existing UTC behavior.
	answer = respondWithAdminSessions(connector, sessions)
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/overview", ownerToken, nil)
	if err := <-answer; err != nil {
		t.Fatalf("Connector UTC answer: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("UTC overview status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &overview)
	if got := overview.PromptTrend[len(overview.PromptTrend)-1].Date; got != now.UTC().Format("2006-01-02") {
		t.Fatalf("default UTC today=%s; want %s", got, now.UTC().Format("2006-01-02"))
	}
}

func TestAuditMobileSessionPersistsRequestID(t *testing.T) {
	environment := newAdminEnvironment(t)
	request := httptest.NewRequest(http.MethodPost, "/v1/mobile/sessions/sess-1/prompt", nil)
	environment.server.auditMobileSession(
		mobileActor{User: store.User{ID: "usr_owner"}}, request,
		"mobile.session.prompt", "dev-1", "sess-1", "req-mobile-audit", nil,
	)
	entries, total, err := environment.server.store.Audit(context.Background(), store.AuditQuery{Action: "mobile.session.prompt", Limit: 10})
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if total != 1 || len(entries) != 1 || entries[0].RequestID != "req-mobile-audit" {
		t.Fatalf("mobile audit requestId was not persisted: total=%d entries=%+v", total, entries)
	}
}
