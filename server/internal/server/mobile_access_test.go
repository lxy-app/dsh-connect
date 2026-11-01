package server

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
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

func TestMobileAccessGrantControlsSessionsWorkspacesAndPrompt(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)

	mobileCode := issueMobilePairingCode(t, environment, ownerToken, "")
	phone := pairMobile(t, environment, mobileCode.Code, "Owner iPhone")

	// Before the desktop grant, the phone sees the desktop but no access.
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/access", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("mobile access overview status=%d body=%s", status, body)
	}
	var overview protocol.MobileAccessOverviewResponse
	decodeTestJSON(t, body, &overview)
	if len(overview.Desktops) != 1 || overview.Desktops[0].Grant != nil || len(overview.Desktops[0].AvailableWorkspaces) != 1 {
		t.Fatalf("unexpected access overview: %+v", overview)
	}
	if !overview.Desktops[0].Online {
		t.Fatal("connected connector should be reported online")
	}

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phone.AccessToken, nil)
	if status != http.StatusOK || string(body) != "{\"workspaces\":[]}\n" {
		t.Fatalf("workspaces before grant status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/sessions", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("sessions before grant status=%d body=%s", status, body)
	}
	var emptySessions protocol.MobileSessionListResponse
	decodeTestJSON(t, body, &emptySessions)
	if len(emptySessions.Sessions) != 0 {
		t.Fatalf("sessions before grant=%+v", emptySessions.Sessions)
	}

	// Only workspaces the desktop itself authorized can be requested.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
		"deviceId": connector.deviceID, "workspaces": []string{"ws-missing"}, "scopes": []string{"read"},
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
		"deviceId": connector.deviceID, "workspaces": []string{"ws-1"}, "scopes": []string{"read", "prompt"},
	})
	if status != http.StatusCreated {
		t.Fatalf("access request status=%d body=%s", status, body)
	}
	var requested protocol.MobileAccessGrant
	decodeTestJSON(t, body, &requested)
	if requested.Status != "pending" || requested.GrantID == "" || requested.DeviceID != connector.deviceID {
		t.Fatalf("unexpected access request: %+v", requested)
	}

	// The desktop panel can list the pending request and approve a subset.
	listed := connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessList, map[string]any{})
	var accessList protocol.ConnectorMobileAccessListResponse
	if err := json.Unmarshal(listed, &accessList); err != nil {
		t.Fatal(err)
	}
	if len(accessList.Grants) != 1 || accessList.Grants[0].Status != "pending" || accessList.Grants[0].MobileDeviceName != "Owner iPhone" {
		t.Fatalf("unexpected desktop access list: %+v", accessList)
	}

	decided := connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessDecide, map[string]any{
		"mobileDeviceId": phone.MobileDeviceID,
		"action":         "allow",
		"workspaces":     []string{"ws-1"},
		"scopes":         []string{"read", "prompt"},
	})
	var grant protocol.MobileAccessGrant
	if err := json.Unmarshal(decided, &grant); err != nil {
		t.Fatal(err)
	}
	if grant.Status != "active" || len(grant.Workspaces) != 1 {
		t.Fatalf("unexpected decision: %+v", grant)
	}

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("workspaces after grant status=%d body=%s", status, body)
	}
	var workspaceList protocol.MobileWorkspaceListResponse
	decodeTestJSON(t, body, &workspaceList)
	if len(workspaceList.Workspaces) != 1 || workspaceList.Workspaces[0].Workspace.ID != "ws-1" || !workspaceList.Workspaces[0].Online {
		t.Fatalf("unexpected workspaces: %+v", workspaceList)
	}

	// The Connector independently enforces actual workspace ownership; the
	// Server filters the returned list to the phone's grant.
	commandErr := make(chan error, 1)
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
	if len(sessions.Sessions) != 1 || sessions.Sessions[0].SessionID != "sess-1" || sessions.Sessions[0].WorkspaceName != "Project" {
		t.Fatalf("unexpected filtered sessions: %+v", sessions)
	}
	if len(sessions.Sessions[0].Scopes) != 2 {
		t.Fatalf("session scopes=%+v", sessions.Sessions[0].Scopes)
	}

	// Transcripts require the granted workspace and are normalized on the desktop.
	go func() {
		commandErr <- answerCommand(connector.connection, protocol.MethodSessionTranscript, map[string]any{
			"messages": []map[string]any{
				{"id": "msg-1", "seq": 1, "role": "user", "text": "hello", "occurredAt": "2026-10-31T12:00:01Z"},
			},
			"hasMore": false,
			"active":  true,
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
	if len(transcript.Messages) != 1 || !transcript.Active || transcript.SessionID != "sess-1" {
		t.Fatalf("unexpected transcript: %+v", transcript)
	}

	// A session in a workspace outside the grant is rejected before any command.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/sessions/sess-2/messages?deviceId="+connector.deviceID+"&workspaceId=ws-2", phone.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	// Prompt uses the idempotent Router and records the mobile actor.
	promptBody := map[string]any{
		"requestId": "mobile-prompt-1", "deviceId": connector.deviceID, "workspaceId": "ws-1",
		"mode": "queue", "text": "continue",
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
	// A replay of the same requestId must not reach the Connector again.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions/sess-1/prompt", phone.AccessToken, promptBody)
	if status != http.StatusOK {
		t.Fatalf("prompt replay status=%d body=%s", status, body)
	}

	// Cancel was not granted (read + prompt only).
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions/sess-1/cancel", phone.AccessToken, map[string]any{
		"requestId": "mobile-cancel-1", "deviceId": connector.deviceID, "workspaceId": "ws-1",
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	// The phone can withdraw its own grant.
	status, body = testRequest(t, http.MethodDelete, environment.http.URL+"/v1/mobile/access/"+requested.GrantID, phone.AccessToken, nil)
	if status != http.StatusNoContent {
		t.Fatalf("revoke grant status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/access", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("access after revoke status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &overview)
	if len(overview.Desktops) != 1 || overview.Desktops[0].Grant == nil || overview.Desktops[0].Grant.Status != "revoked" {
		t.Fatalf("unexpected access after revoke: %+v", overview)
	}

	// Audit contains both the phone request and the desktop decision.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/audit?action=mobile.access.allow&result=success", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("access audit status=%d body=%s", status, body)
	}
	var audit auditListResponse
	decodeTestJSON(t, body, &audit)
	if audit.Total != 1 || audit.Entries[0].DeviceID != connector.deviceID {
		t.Fatalf("unexpected access audit: %+v", audit.Entries)
	}

	// Another phone cannot revoke a grant it does not own.
	secondCode := issueMobilePairingCode(t, environment, ownerToken, ownerID)
	secondPhone := pairMobile(t, environment, secondCode.Code, "Second iPhone")
	status, body = testRequest(t, http.MethodDelete, environment.http.URL+"/v1/mobile/access/"+requested.GrantID, secondPhone.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusNotFound, protocol.CodeNotFound)
}

func TestDesktopCanDenyAndRevokeMobileAccess(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	code := issueMobilePairingCode(t, environment, ownerToken, "")
	phone := pairMobile(t, environment, code.Code, "Panel iPhone")

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
		"deviceId": connector.deviceID, "workspaces": []string{"ws-1"}, "scopes": []string{"read"},
	})
	if status != http.StatusCreated {
		t.Fatalf("access request status=%d body=%s", status, body)
	}

	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessDecide, map[string]any{
		"mobileDeviceId": phone.MobileDeviceID, "action": "deny",
	})
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/access", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("access status=%d body=%s", status, body)
	}
	var overview protocol.MobileAccessOverviewResponse
	decodeTestJSON(t, body, &overview)
	if overview.Desktops[0].Grant == nil || overview.Desktops[0].Grant.Status != "denied" {
		t.Fatalf("expected denied grant: %+v", overview)
	}

	// A denied request can be re-requested and then approved.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
		"deviceId": connector.deviceID, "workspaces": []string{"ws-1"}, "scopes": []string{"read"},
	})
	if status != http.StatusCreated {
		t.Fatalf("re-request status=%d body=%s", status, body)
	}
	var reRequested protocol.MobileAccessGrant
	decodeTestJSON(t, body, &reRequested)
	if reRequested.Status != "pending" {
		t.Fatalf("re-request status=%q", reRequested.Status)
	}
	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessDecide, map[string]any{
		"mobileDeviceId": phone.MobileDeviceID, "action": "allow",
		"workspaces": []string{"ws-1"}, "scopes": []string{"read"},
	})

	// The desktop can revoke the active grant; the phone immediately loses it.
	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessDecide, map[string]any{
		"mobileDeviceId": phone.MobileDeviceID, "action": "revoke",
	})
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/workspaces", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("workspaces after desktop revoke status=%d body=%s", status, body)
	}
	var workspaces protocol.MobileWorkspaceListResponse
	decodeTestJSON(t, body, &workspaces)
	if len(workspaces.Workspaces) != 0 {
		t.Fatalf("workspaces after desktop revoke=%+v", workspaces.Workspaces)
	}

	// Revoking the desktop itself terminates every phone grant.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/devices/"+connector.deviceID+"/revoke", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("desktop revoke status=%d body=%s", status, body)
	}
	grants, err := environment.server.store.MobileAccessGrantsForMobile(context.Background(), phone.MobileDeviceID)
	if err != nil {
		t.Fatal(err)
	}
	for _, grant := range grants {
		if grant.Status == "active" || grant.Status == "pending" {
			t.Fatalf("desktop revocation left a live grant: %+v", grant)
		}
	}
}

func TestMobileLogoutRevokesAccessGrants(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	code := issueMobilePairingCode(t, environment, ownerToken, "")
	phone := pairMobile(t, environment, code.Code, "Logout iPhone")

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
		"deviceId": connector.deviceID, "workspaces": []string{"ws-1"}, "scopes": []string{"read"},
	})
	if status != http.StatusCreated {
		t.Fatalf("access request status=%d body=%s", status, body)
	}
	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessDecide, map[string]any{
		"mobileDeviceId": phone.MobileDeviceID, "action": "allow",
		"workspaces": []string{"ws-1"}, "scopes": []string{"read"},
	})

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/logout", phone.AccessToken, nil)
	if status != http.StatusNoContent {
		t.Fatalf("logout status=%d body=%s", status, body)
	}
	grants, err := environment.server.store.MobileAccessGrantsForMobile(context.Background(), phone.MobileDeviceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || grants[0].Status != "revoked" {
		t.Fatalf("logout did not revoke grants: %+v", grants)
	}
}
