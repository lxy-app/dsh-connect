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

func allowMobileInteractionAccess(t *testing.T, environment *adminEnvironment, connector pairedConnector, phone protocol.MobileSessionResponse, scopes []string) {
	t.Helper()
	allowUserAccess(t, environment, phone.User.ID, connector.deviceID, []string{"ws-1"}, scopes)
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
	connector := pairConnectorWithScopes(t, environment.testEnvironment, []string{"read", "prompt", "approve", "cancel"})
	phone := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Approval iPhone")
	secondPhone := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Approval iPhone B")
	allowMobileInteractionAccess(t, environment, connector, phone, []string{"read", "approve"})

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
	if secondPending := waitForInteractions(t, environment, secondPhone, 1); len(secondPending.Interactions) != 1 {
		t.Fatalf("same-user second phone did not inherit approve policy: %+v", secondPending.Interactions)
	}
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
	waitForInteractions(t, environment, secondPhone, 0)
}

func TestInteractionDecisionRequiresApprovePolicy(t *testing.T) {
	environment := newAdminEnvironment(t)
	connector := pairConnectorWithScopes(t, environment.testEnvironment, []string{"read", "prompt", "approve", "cancel"})
	phone := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Read-only iPhone")
	allowMobileInteractionAccess(t, environment, connector, phone, []string{"read"})

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
	connector := pairConnectorWithScopes(t, environment.testEnvironment, []string{"read", "prompt", "approve", "cancel"})
	phone := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Watching iPhone")
	allowMobileInteractionAccess(t, environment, connector, phone, []string{"read", "approve"})

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
	if got := audience().TTLMS; got != 600_000 {
		t.Fatalf("audience TTLMS=%d; want default 600000", got)
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

func TestInteractionTTLCapProtectsConnectorDeadline(t *testing.T) {
	store := NewInteractionStore(30 * time.Second)
	now := nowUTC()
	if got := store.TTL(); got != 30*time.Second {
		t.Fatalf("TTL=%v; want 30s", got)
	}
	store.Put("dev_1", protocol.InteractionRequestData{
		InteractionID: "int_window", Kind: protocol.InteractionKindApproval,
		SessionID: "sess-1", WorkspaceID: "ws-1", Title: "bash",
		CreatedAt: now, ExpiresAt: now.Add(29 * time.Second),
	}, now.Add(100*time.Millisecond))
	items := store.list(now)
	if len(items) != 1 || !items[0].ExpiresAt.Equal(now.Add(29*time.Second)) {
		t.Fatalf("server changed connector's answer deadline: %+v", items)
	}
	store.SetTTL(30*time.Second, now)
	if got := store.TTL(); got != 30*time.Second {
		t.Fatalf("TTL after update=%v; want 30s", got)
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
