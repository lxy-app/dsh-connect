package server

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

type connectorCommandFrame struct {
	V         int             `json:"v"`
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	Method    string          `json:"method"`
	Params    json.RawMessage `json:"params"`
}

// answerCommand waits for the next Server command and replies with result.
func answerCommand(connection *websocket.Conn, method string, result any) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	messageType, data, err := connection.Read(ctx)
	if err != nil {
		return err
	}
	if messageType != websocket.MessageText {
		return errInvalidFrame
	}
	var command connectorCommandFrame
	if err := json.Unmarshal(data, &command); err != nil {
		return err
	}
	if command.Type != protocol.TypeCommand || command.Method != method {
		return errUnexpectedCommand
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return err
	}
	response, err := json.Marshal(protocol.Result{
		V: protocol.Version, Type: protocol.TypeResult, RequestID: command.RequestID, Result: payload,
	})
	if err != nil {
		return err
	}
	writeCtx, writeCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer writeCancel()
	return connection.Write(writeCtx, websocket.MessageText, response)
}

var (
	errInvalidFrame      = &connectorTestError{"invalid websocket frame"}
	errUnexpectedCommand = &connectorTestError{"unexpected connector command"}
)

type connectorTestError struct{ message string }

func (e *connectorTestError) Error() string { return e.message }

type connectorRequestResult struct {
	Type   string          `json:"type"`
	Result json.RawMessage `json:"result"`
	Error  *protocol.Error `json:"error"`
}

func connectorRequest(t *testing.T, connection *websocket.Conn, method string, params any) json.RawMessage {
	t.Helper()
	payload, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	requestID := "creq-test-" + method + "-" + time.Now().Format("150405.000000")
	writeTestFrame(t, connection, protocol.ConnectorRequest{
		V: protocol.Version, Type: protocol.TypeRequest, RequestID: requestID, Method: method, Params: payload,
	})
	frame := readTestFrame[connectorRequestResult](t, connection)
	if frame.Type != protocol.TypeResult {
		t.Fatalf("connector request %s failed: %+v", method, frame.Error)
	}
	return frame.Result
}

func allowUserAccess(t *testing.T, environment *adminEnvironment, userID, deviceID string, workspaces, scopes []string) store.AccessPolicyRecord {
	t.Helper()
	policyID, err := randomToken("pol_")
	if err != nil {
		t.Fatal(err)
	}
	created, err := environment.server.store.CreateAccessPolicy(context.Background(), store.AccessPolicyRecord{
		PolicyID:  policyID,
		Name:      "Test policy " + policyID,
		Enabled:   true,
		MemberIDs: []string{userID},
		Rules: []store.AccessPolicyRule{{
			DeviceID: deviceID, WorkspaceIDs: workspaces, Scopes: scopes,
		}},
	})
	if err != nil {
		t.Fatalf("create test access policy: %v", err)
	}
	return created
}

func TestUserPolicyControlsSessionsWorkspacesAndPrompt(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	phone := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Owner iPhone")

	// A logged-in phone without any user policy is denied by default.
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/access", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("mobile access overview status=%d body=%s", status, body)
	}
	var overview protocol.MobileAccessOverviewResponse
	decodeTestJSON(t, body, &overview)
	if len(overview.Desktops) != 0 {
		t.Fatalf("policy-less phone received desktops: %+v", overview.Desktops)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phone.AccessToken, nil)
	if status != http.StatusOK || string(body) != "{\"workspaces\":[]}\n" {
		t.Fatalf("policy-less workspaces status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/sessions", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("policy-less sessions status=%d body=%s", status, body)
	}
	var emptySessions protocol.MobileSessionListResponse
	decodeTestJSON(t, body, &emptySessions)
	if len(emptySessions.Sessions) != 0 {
		t.Fatalf("policy-less sessions=%+v", emptySessions.Sessions)
	}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions", phone.AccessToken, map[string]any{
		"requestId": "mobile-create-denied", "deviceId": connector.deviceID, "workspaceId": "ws-1",
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	// A user policy alone grants access; no per-phone grant is requested.
	policy := allowUserAccess(t, environment, phone.User.ID, connector.deviceID, []string{"ws-1"}, []string{"read", "prompt"})
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/access", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("access overview status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &overview)
	if len(overview.Desktops) != 1 || len(overview.Desktops[0].AvailableWorkspaces) != 1 || !overview.Desktops[0].Online {
		t.Fatalf("unexpected access overview: %+v", overview)
	}
	workspaceScopes := overview.Desktops[0].AvailableWorkspaces[0].Scopes
	if len(workspaceScopes) != 2 || workspaceScopes[0] != "read" || workspaceScopes[1] != "prompt" {
		t.Fatalf("overview lost per-workspace scopes: %+v", overview.Desktops[0].AvailableWorkspaces[0])
	}

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("workspaces status=%d body=%s", status, body)
	}
	var workspaceList protocol.MobileWorkspaceListResponse
	decodeTestJSON(t, body, &workspaceList)
	if len(workspaceList.Workspaces) != 1 || workspaceList.Workspaces[0].Workspace.ID != "ws-1" || !workspaceList.Workspaces[0].Online || len(workspaceList.Workspaces[0].Scopes) != 2 {
		t.Fatalf("unexpected workspaces: %+v", workspaceList)
	}

	commandErr := make(chan error, 1)
	createBody := map[string]any{
		"requestId": "mobile-create-1", "deviceId": connector.deviceID, "workspaceId": "ws-1",
	}
	go func() {
		commandErr <- answerCommand(connector.connection, protocol.MethodSessionCreate, map[string]any{
			"sessionId": "sess-created", "workspaceId": "ws-1", "agentPreset": "default",
		})
	}()
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions", phone.AccessToken, createBody)
	if err := <-commandErr; err != nil {
		t.Fatal(err)
	}
	if status != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", status, body)
	}
	var created protocol.SessionCreateResult
	decodeTestJSON(t, body, &created)
	if created.SessionID != "sess-created" || created.WorkspaceID != "ws-1" || created.AgentPreset != "default" {
		t.Fatalf("unexpected created session: %+v", created)
	}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions", phone.AccessToken, createBody)
	if status != http.StatusCreated {
		t.Fatalf("create replay status=%d body=%s", status, body)
	}

	// The Server filters Connector output to the user's effective workspaces.
	go func() {
		commandErr <- answerCommand(connector.connection, protocol.MethodSessionList, map[string]any{
			"sessions": []map[string]any{
				{"sessionId": "sess-1", "workspaceId": "ws-1", "title": "Granted session", "status": "running", "updatedAt": "2026-10-31T12:00:00Z"},
				{"sessionId": "sess-2", "workspaceId": "ws-2", "title": "Not granted", "status": "idle", "updatedAt": "2026-10-31T13:00:00Z"},
			},
		})
	}()
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/sessions", phone.AccessToken, nil)
	if err := <-commandErr; err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("sessions status=%d body=%s", status, body)
	}
	var sessions protocol.MobileSessionListResponse
	decodeTestJSON(t, body, &sessions)
	if len(sessions.Sessions) != 1 || sessions.Sessions[0].SessionID != "sess-1" || sessions.Sessions[0].WorkspaceName != "Project" || len(sessions.Sessions[0].Scopes) != 2 {
		t.Fatalf("unexpected filtered sessions: %+v", sessions)
	}

	go func() {
		commandErr <- answerCommand(connector.connection, protocol.MethodSessionTranscript, map[string]any{
			"messages": []map[string]any{
				{"id": "msg-1", "seq": 1, "role": "user", "text": "hello", "occurredAt": "2026-10-31T12:00:01Z"},
			},
			"hasMore": false, "active": true, "turnEndSeq": 1,
		})
	}()
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/sessions/sess-1/messages?deviceId="+connector.deviceID+"&workspaceId=ws-1", phone.AccessToken, nil)
	if err := <-commandErr; err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("transcript status=%d body=%s", status, body)
	}
	var transcript protocol.MobileTranscriptResponse
	decodeTestJSON(t, body, &transcript)
	if len(transcript.Messages) != 1 || !transcript.Active || transcript.SessionID != "sess-1" || transcript.TurnEndSeq != 1 {
		t.Fatalf("unexpected transcript: %+v", transcript)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/sessions/sess-2/messages?deviceId="+connector.deviceID+"&workspaceId=ws-2", phone.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	promptBody := map[string]any{
		"requestId": "mobile-prompt-1", "deviceId": connector.deviceID, "workspaceId": "ws-1", "mode": "queue", "text": "continue",
	}
	go func() {
		commandErr <- answerCommand(connector.connection, protocol.MethodSessionPrompt, map[string]any{
			"sessionId": "sess-1", "requestId": "mobile-prompt-1", "status": "accepted",
		})
	}()
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions/sess-1/prompt", phone.AccessToken, promptBody)
	if err := <-commandErr; err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("prompt status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions/sess-1/prompt", phone.AccessToken, promptBody)
	if status != http.StatusOK {
		t.Fatalf("prompt replay status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions/sess-1/cancel", phone.AccessToken, map[string]any{
		"requestId": "mobile-cancel-1", "deviceId": connector.deviceID, "workspaceId": "ws-1",
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	// Authorization precedes the idempotency cache after a policy is disabled.
	disabled := false
	if _, err := environment.server.store.UpdateAccessPolicy(context.Background(), policy.PolicyID, policy.Revision, store.AccessPolicyUpdate{Enabled: &disabled}); err != nil {
		t.Fatalf("disable policy: %v", err)
	}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions", phone.AccessToken, createBody)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions/sess-1/prompt", phone.AccessToken, promptBody)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/audit?action=mobile.session.create&result=success", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("create audit status=%d body=%s", status, body)
	}
	var audit auditListResponse
	decodeTestJSON(t, body, &audit)
	if audit.Total != 2 || audit.Entries[0].SessionID != "sess-created" || audit.Entries[1].SessionID != "sess-created" {
		t.Fatalf("unexpected create audit: %+v", audit.Entries)
	}
}

func TestSameUserPhonesInheritPolicyWithoutDeviceGrants(t *testing.T) {
	environment := newAdminEnvironment(t)
	connector := pairConnector(t, environment.testEnvironment)
	phoneA := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Owner iPhone A")
	phoneB := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Owner iPhone B")
	if phoneA.MobileDeviceID == phoneB.MobileDeviceID {
		t.Fatal("separate logins must retain separate credential device identities")
	}
	allowUserAccess(t, environment, phoneA.User.ID, connector.deviceID, []string{"ws-1"}, []string{"read"})

	commandErr := make(chan error, 1)
	for index, phone := range []protocol.MobileSessionResponse{phoneA, phoneB} {
		status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phone.AccessToken, nil)
		if status != http.StatusOK {
			t.Fatalf("phone %d workspaces status=%d body=%s", index, status, body)
		}
		var workspaces protocol.MobileWorkspaceListResponse
		decodeTestJSON(t, body, &workspaces)
		if len(workspaces.Workspaces) != 1 || workspaces.Workspaces[0].Workspace.ID != "ws-1" {
			t.Fatalf("phone %d did not inherit user policy: %+v", index, workspaces.Workspaces)
		}

		go func() {
			commandErr <- answerCommand(connector.connection, protocol.MethodSessionTranscript, map[string]any{
				"messages": []map[string]any{}, "hasMore": false, "active": false,
			})
		}()
		status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/sessions/sess-1/messages?deviceId="+connector.deviceID+"&workspaceId=ws-1", phone.AccessToken, nil)
		if err := <-commandErr; err != nil {
			t.Fatal(err)
		}
		if status != http.StatusOK {
			t.Fatalf("phone %d transcript status=%d body=%s", index, status, body)
		}
	}
}

func TestUserWithoutPolicyCannotUseAnotherUsersCoordinates(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	allowUserAccess(t, environment, ownerID, connector.deviceID, []string{"ws-1"}, []string{"read", "prompt"})

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": "policy-less-mobile@example.com", "displayName": "Policy Less", "password": "member-password", "role": store.RoleMember,
	})
	if status != http.StatusCreated {
		t.Fatalf("create member status=%d body=%s", status, body)
	}
	var member store.User
	decodeTestJSON(t, body, &member)
	phone := loginMobile(t, environment, member.Email, "member-password", "Policy Less iPhone")

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/access", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("access status=%d body=%s", status, body)
	}
	var overview protocol.MobileAccessOverviewResponse
	decodeTestJSON(t, body, &overview)
	if len(overview.Desktops) != 0 {
		t.Fatalf("user inherited another user's policy: %+v", overview.Desktops)
	}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions", phone.AccessToken, map[string]any{
		"requestId": "cross-user-create", "deviceId": connector.deviceID, "workspaceId": "ws-1",
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
}

func TestConnectorGrantNarrowingImmediatelyLimitsUserPolicy(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnectorWithScopes(t, environment.testEnvironment, []string{"read", "prompt", "approve", "cancel"})
	connectorRequest(t, connector.connection, protocol.ConnectorMethodPairUpdateGrants, map[string]any{
		"workspaces": []protocol.Workspace{{ID: "ws-1", Name: "Project", Path: "/tmp/project"}, {ID: "ws-2", Name: "Second", Path: "/tmp/second"}},
		"scopes":     []string{"read", "prompt", "approve", "cancel"},
	})
	phone := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Connector Narrowing iPhone")
	allowUserAccess(t, environment, ownerID, connector.deviceID, []string{"ws-1", "ws-2"}, []string{"read", "prompt", "cancel"})

	connectorRequest(t, connector.connection, protocol.ConnectorMethodPairUpdateGrants, map[string]any{
		"workspaces": []protocol.Workspace{{ID: "ws-1", Name: "Project", Path: "/tmp/project"}},
		"scopes":     []string{"read"},
	})
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("narrowed workspaces status=%d body=%s", status, body)
	}
	var workspaces protocol.MobileWorkspaceListResponse
	decodeTestJSON(t, body, &workspaces)
	if len(workspaces.Workspaces) != 1 || workspaces.Workspaces[0].Workspace.ID != "ws-1" || len(workspaces.Workspaces[0].Scopes) != 1 || workspaces.Workspaces[0].Scopes[0] != "read" {
		t.Fatalf("Connector narrowing was not applied: %+v", workspaces.Workspaces)
	}
	for name, request := range map[string]struct {
		method string
		path   string
		body   map[string]any
	}{
		"prompt removed scope": {http.MethodPost, "/v1/mobile/sessions/sess-1/prompt", map[string]any{"requestId": "narrowed-prompt", "deviceId": connector.deviceID, "workspaceId": "ws-1", "mode": "queue", "text": "must not run"}},
		"cancel removed scope": {http.MethodPost, "/v1/mobile/sessions/sess-1/cancel", map[string]any{"requestId": "narrowed-cancel", "deviceId": connector.deviceID, "workspaceId": "ws-1"}},
		"removed workspace":    {http.MethodGet, "/v1/mobile/sessions/sess-2/messages?deviceId=" + connector.deviceID + "&workspaceId=ws-2", nil},
	} {
		t.Run(name, func(t *testing.T) {
			status, body := testRequest(t, request.method, environment.http.URL+request.path, phone.AccessToken, request.body)
			assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
		})
	}

	// Revoking the desktop itself removes all user-policy projections.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/devices/"+connector.deviceID+"/revoke", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("desktop revoke status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phone.AccessToken, nil)
	if status != http.StatusOK || string(body) != "{\"workspaces\":[]}\n" {
		t.Fatalf("workspaces after desktop revoke status=%d body=%s", status, body)
	}
}

func TestPolicyNarrowingImmediatelyAppliesToEveryUserPhone(t *testing.T) {
	environment := newAdminEnvironment(t)
	connector := pairConnector(t, environment.testEnvironment)
	phoneA := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Policy iPhone A")
	phoneB := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Policy iPhone B")
	policy := allowUserAccess(t, environment, phoneA.User.ID, connector.deviceID, []string{"ws-1"}, []string{"read", "prompt"})

	rules := []store.AccessPolicyRule{{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read"}}}
	updated, err := environment.server.store.UpdateAccessPolicy(context.Background(), policy.PolicyID, policy.Revision, store.AccessPolicyUpdate{Rules: &rules})
	if err != nil {
		t.Fatalf("narrow policy: %v", err)
	}
	for index, phone := range []protocol.MobileSessionResponse{phoneA, phoneB} {
		status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions/sess-1/prompt", phone.AccessToken, map[string]any{
			"requestId": "narrowed-prompt-" + phone.MobileDeviceID, "deviceId": connector.deviceID, "workspaceId": "ws-1", "mode": "queue", "text": "must not run",
		})
		assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
		status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phone.AccessToken, nil)
		if status != http.StatusOK {
			t.Fatalf("phone %d workspaces status=%d body=%s", index, status, body)
		}
		var workspaces protocol.MobileWorkspaceListResponse
		decodeTestJSON(t, body, &workspaces)
		if len(workspaces.Workspaces) != 1 || len(workspaces.Workspaces[0].Scopes) != 1 || workspaces.Workspaces[0].Scopes[0] != "read" {
			t.Fatalf("phone %d retained narrowed scope: %+v", index, workspaces.Workspaces)
		}
	}

	emptyRules := []store.AccessPolicyRule{}
	if _, err := environment.server.store.UpdateAccessPolicy(context.Background(), policy.PolicyID, updated.Revision, store.AccessPolicyUpdate{Rules: &emptyRules}); err != nil {
		t.Fatalf("remove policy rules: %v", err)
	}
	for _, phone := range []protocol.MobileSessionResponse{phoneA, phoneB} {
		status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phone.AccessToken, nil)
		if status != http.StatusOK || string(body) != "{\"workspaces\":[]}\n" {
			t.Fatalf("workspaces after policy removal status=%d body=%s", status, body)
		}
	}
}

func TestMobileLogoutRevokesOnlyCurrentDevice(t *testing.T) {
	environment := newAdminEnvironment(t)
	connector := pairConnector(t, environment.testEnvironment)
	phoneA := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Logout iPhone A")
	phoneB := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Logout iPhone B")
	allowUserAccess(t, environment, phoneA.User.ID, connector.deviceID, []string{"ws-1"}, []string{"read"})

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/logout", phoneA.AccessToken, nil)
	if status != http.StatusNoContent {
		t.Fatalf("logout status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phoneA.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phoneB.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("other phone lost access after logout: status=%d body=%s", status, body)
	}
	var workspaces protocol.MobileWorkspaceListResponse
	decodeTestJSON(t, body, &workspaces)
	if len(workspaces.Workspaces) != 1 {
		t.Fatalf("other phone workspaces=%+v", workspaces.Workspaces)
	}
}
