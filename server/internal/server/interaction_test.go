package server

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
)

func interactionEvent(t *testing.T, deviceID, sessionID string, data protocol.InteractionRequestData) protocol.Event {
	t.Helper()
	payload, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	return protocol.Event{
		V:          protocol.Version,
		Type:       protocol.TypeEvent,
		EventID:    "evt_test_interaction",
		DeviceID:   deviceID,
		SessionID:  sessionID,
		Kind:       protocol.KindInteractionRequest,
		OccurredAt: nowUTC(),
		Data:       payload,
	}
}

func approveMobileAccess(t *testing.T, environment *adminEnvironment, connector pairedConnector, phone protocol.MobileSessionResponse, scopes []string) {
	t.Helper()
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
		"deviceId": connector.deviceID, "workspaces": []string{"ws-1"}, "scopes": scopes,
	})
	if status != http.StatusCreated {
		t.Fatalf("access request status=%d body=%s", status, body)
	}
	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessList, map[string]any{})
	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessDecide, map[string]any{
		"mobileDeviceId": phone.MobileDeviceID,
		"action":         "allow",
		"workspaces":     []string{"ws-1"},
		"scopes":         scopes,
	})
}

func listInteractions(t *testing.T, environment *adminEnvironment, phone protocol.MobileSessionResponse) protocol.MobileInteractionListResponse {
	t.Helper()
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/interactions", phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("list interactions status=%d body=%s", status, body)
	}
	var response protocol.MobileInteractionListResponse
	decodeTestJSON(t, body, &response)
	return response
}

func waitForInteractions(t *testing.T, environment *adminEnvironment, phone protocol.MobileSessionResponse, wanted int) protocol.MobileInteractionListResponse {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var last protocol.MobileInteractionListResponse
	for time.Now().Before(deadline) {
		last = listInteractions(t, environment, phone)
		if len(last.Interactions) == wanted {
			return last
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("interactions never reached %d: %+v", wanted, last)
	return last
}

func TestInteractionRelayRoundTrip(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnectorWithScopes(t, environment.testEnvironment, []string{"read", "prompt", "approve", "cancel"})
	phone := pairMobile(t, environment, issueMobilePairingCode(t, environment, ownerToken, "").Code, "Approval iPhone")
	approveMobileAccess(t, environment, connector, phone, []string{"read", "approve"})

	now := nowUTC()
	writeTestFrame(t, connector.connection, interactionEvent(t, connector.deviceID, "sess-1", protocol.InteractionRequestData{
		InteractionID: "int_test_1",
		Kind:          protocol.InteractionKindApproval,
		SessionID:     "sess-1",
		WorkspaceID:   "ws-1",
		WorkspaceName: "Project",
		Title:         "bash",
		ToolName:      "bash",
		Reason:        "restart Chrome",
		CreatedAt:     now,
		ExpiresAt:     now.Add(2 * time.Minute),
	}))

	pending := waitForInteractions(t, environment, phone, 1)
	item := pending.Interactions[0]
	if item.InteractionID != "int_test_1" || item.Kind != protocol.InteractionKindApproval || item.DeviceID != connector.deviceID || item.SessionID != "sess-1" || item.Title != "bash" {
		t.Fatalf("unexpected interaction projection: %+v", item)
	}

	decision := make(chan error, 1)
	go func() {
		decision <- answerCommand(connector.connection, protocol.MethodInteractionRespond, map[string]any{
			"accepted": true, "interactionId": "int_test_1",
		})
	}()
	status, body := testRequest(t, http.MethodPost,
		environment.http.URL+"/v1/mobile/interactions/int_test_1/decision", phone.AccessToken,
		map[string]any{"requestId": "mint_test_1", "decision": "allow-once"})
	if status != http.StatusOK {
		t.Fatalf("decision status=%d body=%s", status, body)
	}
	if err := <-decision; err != nil {
		t.Fatalf("connector command: %v", err)
	}
	waitForInteractions(t, environment, phone, 0)
}

func TestInteractionDecisionRequiresApproveGrant(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnectorWithScopes(t, environment.testEnvironment, []string{"read", "prompt", "approve", "cancel"})
	phone := pairMobile(t, environment, issueMobilePairingCode(t, environment, ownerToken, "").Code, "Read-only iPhone")
	approveMobileAccess(t, environment, connector, phone, []string{"read"})

	now := nowUTC()
	writeTestFrame(t, connector.connection, interactionEvent(t, connector.deviceID, "sess-1", protocol.InteractionRequestData{
		InteractionID: "int_test_2",
		Kind:          protocol.InteractionKindApproval,
		SessionID:     "sess-1",
		WorkspaceID:   "ws-1",
		Title:         "bash",
		CreatedAt:     now,
		ExpiresAt:     now.Add(time.Minute),
	}))

	// The request is stored but must never be offered to a phone without the
	// approve scope.
	waitForInteractions(t, environment, phone, 0)
	status, body := testRequest(t, http.MethodPost,
		environment.http.URL+"/v1/mobile/interactions/int_test_2/decision", phone.AccessToken,
		map[string]any{"requestId": "mint_test_2", "decision": "allow-once"})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
}

func TestConnectorCanEnableApproveWithoutRepairing(t *testing.T) {
	environment := newTestEnvironment(t)
	connector := pairConnector(t, environment)

	// The legacy device record has no approve scope.
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/devices", testBootstrapToken, nil)
	if status != http.StatusOK {
		t.Fatalf("GET devices status=%d body=%s", status, body)
	}
	var devices protocol.DeviceListResponse
	decodeTestJSON(t, body, &devices)
	if contains(devices.Devices[0].Scopes, "approve") {
		t.Fatalf("fresh pairing should not include approve: %+v", devices.Devices[0].Scopes)
	}

	workspaces := []protocol.Workspace{{ID: "ws-1", Name: "Project", Path: "/tmp/project"}}
	result := connectorRequest(t, connector.connection, protocol.ConnectorMethodPairUpdateGrants, map[string]any{
		"workspaces": workspaces,
		"scopes":     []string{"read", "prompt", "approve", "cancel"},
	})
	var device protocol.Device
	if err := json.Unmarshal(result, &device); err != nil {
		t.Fatal(err)
	}
	if device.DeviceID != connector.deviceID || len(device.Scopes) != 4 || !contains(device.Scopes, "approve") {
		t.Fatalf("unexpected updated device: %+v", device)
	}

	// The persisted grant is what later command authorization reads.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/devices", testBootstrapToken, nil)
	if status != http.StatusOK {
		t.Fatalf("GET devices status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &devices)
	if !contains(devices.Devices[0].Scopes, "approve") {
		t.Fatalf("approve scope was not persisted: %+v", devices.Devices[0].Scopes)
	}

	// Unknown scopes fail closed and leave the existing grant intact.
	writeTestFrame(t, connector.connection, protocol.ConnectorRequest{
		V: protocol.Version, Type: protocol.TypeRequest, RequestID: "creq-grants-invalid",
		Method: protocol.ConnectorMethodPairUpdateGrants,
		Params: json.RawMessage(`{"workspaces":[{"id":"ws-1","name":"Project","path":"/tmp/project"}],"scopes":["root"]}`),
	})
	rejected := readTestFrame[protocol.ErrorEnvelope](t, connector.connection)
	if rejected.Type != protocol.TypeError || rejected.Error.Code != protocol.CodeInvalidRequest {
		t.Fatalf("invalid scope update was not rejected: %+v", rejected)
	}
}

func TestConnectorInteractionAudienceFollowsPhonePolling(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnectorWithScopes(t, environment.testEnvironment, []string{"read", "prompt", "approve", "cancel"})
	phone := pairMobile(t, environment, issueMobilePairingCode(t, environment, ownerToken, "").Code, "Watching iPhone")
	approveMobileAccess(t, environment, connector, phone, []string{"read", "approve"})

	audience := func() protocol.InteractionAudienceResponse {
		t.Helper()
		raw := connectorRequest(t, connector.connection, protocol.ConnectorMethodInteractionAudience, map[string]any{
			"workspaceId": "ws-1",
		})
		var response protocol.InteractionAudienceResponse
		if err := json.Unmarshal(raw, &response); err != nil {
			t.Fatal(err)
		}
		return response
	}

	if audience().Watching {
		t.Fatal("phone must not count as watching before it polls")
	}
	// The phone's own list read is the presence signal.
	listInteractions(t, environment, phone)
	if !audience().Watching {
		t.Fatal("phone poll did not register as watching")
	}

	// A workspace the phone was not granted never counts as watched.
	raw := connectorRequest(t, connector.connection, protocol.ConnectorMethodInteractionAudience, map[string]any{
		"workspaceId": "ws-other",
	})
	var other protocol.InteractionAudienceResponse
	if err := json.Unmarshal(raw, &other); err != nil {
		t.Fatal(err)
	}
	if other.Watching {
		t.Fatal("ungranted workspace must not report a watching phone")
	}
}

func TestInteractionExpiryAndDropOnDisconnect(t *testing.T) {
	store := NewInteractionStore(time.Minute)
	now := nowUTC()
	store.Put("dev_1", protocol.InteractionRequestData{
		InteractionID: "int_drop", Kind: protocol.InteractionKindApproval,
		SessionID: "sess-1", WorkspaceID: "ws-1", Title: "bash",
		CreatedAt: now, ExpiresAt: now.Add(time.Minute),
	}, now)
	store.Put("dev_1", protocol.InteractionRequestData{
		InteractionID: "int_expired", Kind: protocol.InteractionKindApproval,
		SessionID: "sess-1", WorkspaceID: "ws-1", Title: "bash",
		CreatedAt: now, ExpiresAt: now.Add(-time.Second),
	}, now)
	if listed := store.list(now); len(listed) != 1 || listed[0].InteractionID != "int_drop" {
		t.Fatalf("unexpected pending interactions: %+v", listed)
	}
	store.DropDevice("dev_1")
	if listed := store.list(now); len(listed) != 0 {
		t.Fatalf("drop device left interactions: %+v", listed)
	}
}

func TestInteractionResolvedEventClearsPending(t *testing.T) {
	store := NewInteractionStore(time.Minute)
	now := nowUTC()
	store.Put("dev_1", protocol.InteractionRequestData{
		InteractionID: "int_resolved", Kind: protocol.InteractionKindQuestion,
		SessionID: "sess-1", WorkspaceID: "ws-1", Title: "question",
		Questions: []protocol.InteractionQuestion{{ID: "q1", Question: "Continue?"}},
		CreatedAt: now, ExpiresAt: now.Add(time.Minute),
	}, now)
	if listed := store.list(now); len(listed) != 1 {
		t.Fatalf("expected one pending interaction: %+v", listed)
	}
	payload, _ := json.Marshal(protocol.InteractionResolvedData{InteractionID: "int_resolved", Resolution: protocol.InteractionResolutionDesktop})
	server := &Server{interactions: store}
	server.ingestInteractionEvent(protocol.Event{
		V: protocol.Version, Type: protocol.TypeEvent, EventID: "evt_resolved",
		DeviceID: "dev_1", SessionID: "sess-1", Kind: protocol.KindInteractionResolved,
		OccurredAt: now, Data: payload,
	})
	if listed := store.list(now); len(listed) != 0 {
		t.Fatalf("resolved interaction still pending: %+v", listed)
	}
}
