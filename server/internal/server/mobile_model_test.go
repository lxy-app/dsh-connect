package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
)

type mobileModelFixture struct {
	environment *adminEnvironment
	ownerToken  string
	connector   pairedConnector
	phone       protocol.MobileSessionResponse
	grantID     string
}

func newMobileModelFixture(t *testing.T, scopes []string) mobileModelFixture {
	t.Helper()
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	code := issueMobilePairingCode(t, environment, ownerToken, "")
	phone := pairMobile(t, environment, code.Code, "Model iPhone")
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
		"deviceId": connector.deviceID, "workspaces": []string{"ws-1"}, "scopes": scopes,
	})
	if status != http.StatusCreated {
		t.Fatalf("model access request status=%d body=%s", status, body)
	}
	var requested protocol.MobileAccessGrant
	decodeTestJSON(t, body, &requested)
	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessDecide, map[string]any{
		"mobileDeviceId": phone.MobileDeviceID,
		"action":         "allow",
		"workspaces":     []string{"ws-1"},
		"scopes":         scopes,
	})
	return mobileModelFixture{environment: environment, ownerToken: ownerToken, connector: connector, phone: phone, grantID: requested.GrantID}
}

func serveModelCommand(connection *websocket.Conn, method string, expectedParams map[string]any, result any) <-chan error {
	done := make(chan error, 1)
	go func() {
		command, err := readWS[protocol.Command](connection)
		if err != nil {
			done <- err
			return
		}
		if command.Method != method {
			done <- fmt.Errorf("method=%q; want %q", command.Method, method)
			return
		}
		var params map[string]any
		if err := json.Unmarshal(command.Params, &params); err != nil {
			done <- err
			return
		}
		if !reflect.DeepEqual(params, expectedParams) {
			done <- fmt.Errorf("params=%#v; want %#v", params, expectedParams)
			return
		}
		payload, err := json.Marshal(result)
		if err != nil {
			done <- err
			return
		}
		done <- writeWS(connection, protocol.Result{
			V: protocol.Version, Type: protocol.TypeResult, RequestID: command.RequestID, Result: payload,
		})
	}()
	return done
}

func TestMobileModelCatalogSelectionIdempotencyAndRestart(t *testing.T) {
	fixture := newMobileModelFixture(t, []string{"read", "prompt"})
	environment := fixture.environment
	modelURL := environment.http.URL + "/v1/mobile/sessions/sess-1/model"

	// Unknown fields and an explicitly empty effort fail strict REST validation.
	status, body := testRequest(t, http.MethodPost, modelURL, fixture.phone.AccessToken, map[string]any{
		"requestId": "model-unknown-field", "deviceId": fixture.connector.deviceID, "workspaceId": "ws-1",
		"provider": "deepseek", "model": "deepseek-reasoner", "persistDefault": false,
	})
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)
	status, body = testRequest(t, http.MethodPost, modelURL, fixture.phone.AccessToken, map[string]any{
		"requestId": "model-empty-effort", "deviceId": fixture.connector.deviceID, "workspaceId": "ws-1",
		"provider": "deepseek", "model": "deepseek-reasoner", "reasoningEffort": "",
	})
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)

	catalogResult := map[string]any{
		"sessionId": "sess-1", "deviceId": fixture.connector.deviceID, "workspaceId": "ws-1",
		"default":           map[string]any{"provider": "deepseek", "model": "deepseek-chat"},
		"lastUsed":          nil,
		"next":              map[string]any{"provider": "deepseek", "model": "deepseek-reasoner", "reasoningEffort": "high"},
		"effective":         map[string]any{"provider": "deepseek", "model": "deepseek-reasoner", "reasoningEffort": "high"},
		"routableProviders": nil,
		"groups": []any{map[string]any{
			"id": "deepseek", "name": "DeepSeek",
			"models": []any{map[string]any{
				"id": "deepseek-reasoner", "name": "DeepSeek Reasoner",
				"reasoning": map[string]any{"efforts": []any{map[string]any{"id": "high", "name": "High"}}, "defaultEffort": "high"},
			}},
		}},
		"failures": nil, "projectionKind": "sequenced",
	}
	commandErr := serveModelCommand(fixture.connector.connection, protocol.MethodSessionModelCatalog, map[string]any{
		"sessionId": "sess-1", "workspaceId": "ws-1",
	}, catalogResult)
	status, body = testRequest(t, http.MethodGet, modelURL+"?deviceId="+fixture.connector.deviceID+"&workspaceId=ws-1", fixture.phone.AccessToken, nil)
	if err := <-commandErr; err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("model catalog status=%d body=%s", status, body)
	}
	var catalog protocol.MobileModelCatalogResponse
	decodeTestJSON(t, body, &catalog)
	if catalog.Effective.Model != "deepseek-reasoner" || catalog.Effective.ReasoningEffort == nil || *catalog.Effective.ReasoningEffort != "high" {
		t.Fatalf("unexpected effective selection: %+v", catalog.Effective)
	}
	if catalog.LastUsed != nil || catalog.Next == nil || catalog.ProjectionKind != "sequenced" {
		t.Fatalf("unexpected projection: %+v", catalog)
	}
	if catalog.RoutableProviders == nil || catalog.Failures == nil || len(catalog.Groups) != 1 || len(catalog.Groups[0].Models) != 1 {
		t.Fatalf("catalog arrays were not normalized: %+v", catalog)
	}

	// A workspace outside the phone grant is rejected before any Connector call.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/sessions/sess-2/model?deviceId="+fixture.connector.deviceID+"&workspaceId=ws-2", fixture.phone.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	selectBody := map[string]any{
		"requestId": "model-select-1", "deviceId": fixture.connector.deviceID, "workspaceId": "ws-1",
		"provider": "deepseek", "model": "deepseek-reasoner", "reasoningEffort": "high",
	}
	selectedResult := map[string]any{
		"sessionId": "sess-1", "requestId": "model-select-1",
		"selected": map[string]any{"provider": "deepseek", "model": "deepseek-reasoner", "reasoningEffort": "high"},
	}
	commandErr = serveModelCommand(fixture.connector.connection, protocol.MethodSessionModelSelect, map[string]any{
		"sessionId": "sess-1", "workspaceId": "ws-1", "provider": "deepseek", "model": "deepseek-reasoner", "reasoningEffort": "high",
	}, selectedResult)
	status, body = testRequest(t, http.MethodPost, modelURL, fixture.phone.AccessToken, selectBody)
	if err := <-commandErr; err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("model select status=%d body=%s", status, body)
	}
	firstBody := body
	var selected protocol.MobileModelSelectResponse
	decodeTestJSON(t, body, &selected)
	if selected.SessionID != "sess-1" || selected.RequestID != "model-select-1" || selected.Selected.ReasoningEffort == nil {
		t.Fatalf("unexpected selection response: %+v", selected)
	}

	// Completed retries return the durable result without another Connector command.
	status, body = testRequest(t, http.MethodPost, modelURL, fixture.phone.AccessToken, selectBody)
	if status != http.StatusOK || !bytes.Equal(firstBody, body) {
		t.Fatalf("model select replay status=%d body=%s", status, body)
	}
	changed := map[string]any{}
	for key, value := range selectBody {
		changed[key] = value
	}
	changed["model"] = "deepseek-chat"
	status, body = testRequest(t, http.MethodPost, modelURL, fixture.phone.AccessToken, changed)
	assertErrorResponse(t, status, body, http.StatusConflict, protocol.CodeIdempotencyConflict)

	// Connector model failures keep their stable code and map to HTTP 409.
	unavailableDone := make(chan error, 1)
	go func() {
		command, err := readWS[protocol.Command](fixture.connector.connection)
		if err != nil {
			unavailableDone <- err
			return
		}
		unavailableDone <- writeWS(fixture.connector.connection, protocol.ErrorEnvelope{
			V: protocol.Version, Type: protocol.TypeError, RequestID: command.RequestID,
			Error: protocol.Error{Code: protocol.CodeModelUnavailable, Message: "model is unavailable", Retryable: false},
		})
	}()
	unavailableBody := map[string]any{
		"requestId": "model-select-unavailable", "deviceId": fixture.connector.deviceID, "workspaceId": "ws-1",
		"provider": "deepseek", "model": "missing",
	}
	status, body = testRequest(t, http.MethodPost, modelURL, fixture.phone.AccessToken, unavailableBody)
	if err := <-unavailableDone; err != nil {
		t.Fatal(err)
	}
	assertErrorResponse(t, status, body, http.StatusConflict, protocol.CodeModelUnavailable)

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/audit?action=mobile.session.model.select", fixture.ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("model audit status=%d body=%s", status, body)
	}
	var audit auditListResponse
	decodeTestJSON(t, body, &audit)
	if audit.Total != 4 {
		t.Fatalf("model audit total=%d; want success, replay, conflict and unavailable", audit.Total)
	}

	// Restarting the Server does not lose the persisted selection outcome. No
	// Connector is online for this replay, so it cannot be a hidden second write.
	environment.close()
	_ = fixture.connector.connection.Close(websocket.StatusNormalClosure, "restart")
	restarted, err := New(context.Background(), Config{
		BootstrapToken: testBootstrapToken, DatabaseURL: environment.databaseURL, ServerURL: "http://server.test",
		BootstrapOwnerEmail: testOwnerEmail, BootstrapOwnerPassword: testOwnerPassword, BootstrapOwnerName: "Test Owner",
	})
	if err != nil {
		t.Fatalf("restart New() error: %v", err)
	}
	defer restarted.Close()
	restartedHTTP := httptest.NewServer(restarted.Handler())
	defer restartedHTTP.Close()
	status, body = testRequest(t, http.MethodPost, restartedHTTP.URL+"/v1/mobile/sessions/sess-1/model", fixture.phone.AccessToken, selectBody)
	if status != http.StatusOK || !bytes.Equal(firstBody, body) {
		t.Fatalf("persisted model replay status=%d body=%s", status, body)
	}

	// Authorization still precedes the cache after restart and revocation.
	status, body = testRequest(t, http.MethodDelete, restartedHTTP.URL+"/v1/mobile/access/"+fixture.grantID, fixture.phone.AccessToken, nil)
	if status != http.StatusNoContent {
		t.Fatalf("revoke model grant status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodPost, restartedHTTP.URL+"/v1/mobile/sessions/sess-1/model", fixture.phone.AccessToken, selectBody)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
}

func TestMobileModelReadOnlyGrantCannotSelect(t *testing.T) {
	fixture := newMobileModelFixture(t, []string{"read"})
	modelURL := fixture.environment.http.URL + "/v1/mobile/sessions/sess-1/model"
	catalogResult := map[string]any{
		"sessionId": "sess-1", "deviceId": fixture.connector.deviceID, "workspaceId": "ws-1",
		"default":  map[string]any{"provider": "deepseek", "model": "deepseek-chat"},
		"lastUsed": nil, "next": nil,
		"effective":         map[string]any{"provider": "deepseek", "model": "deepseek-chat"},
		"routableProviders": []string{}, "groups": []any{}, "failures": []any{}, "projectionKind": "sequenced",
	}
	commandErr := serveModelCommand(fixture.connector.connection, protocol.MethodSessionModelCatalog, map[string]any{
		"sessionId": "sess-1", "workspaceId": "ws-1",
	}, catalogResult)
	status, body := testRequest(t, http.MethodGet, modelURL+"?deviceId="+fixture.connector.deviceID+"&workspaceId=ws-1", fixture.phone.AccessToken, nil)
	if err := <-commandErr; err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("read-only catalog status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodPost, modelURL, fixture.phone.AccessToken, map[string]any{
		"requestId": "model-read-only", "deviceId": fixture.connector.deviceID, "workspaceId": "ws-1",
		"provider": "deepseek", "model": "deepseek-reasoner",
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
}
