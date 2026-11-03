package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/pgtest"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const testBootstrapToken = "integration-bootstrap-token"

func TestMain(m *testing.M) {
	code := m.Run()
	pgtest.CleanupContainer()
	os.Exit(code)
}

type testEnvironment struct {
	server      *Server
	http        *httptest.Server
	databaseURL string
	closeOnce   sync.Once
}

func newTestEnvironment(t *testing.T, change ...func(*Config)) *testEnvironment {
	t.Helper()
	config := Config{
		BootstrapToken:    testBootstrapToken,
		DatabaseURL:       pgtest.NewDatabase(t),
		ServerURL:         "http://server.test",
		CommandTimeout:    time.Second,
		HeartbeatInterval: time.Second,
		EventBuffer:       8,
	}
	for _, apply := range change {
		apply(&config)
	}
	server, err := New(context.Background(), config)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}
	httpServer := httptest.NewServer(server.Handler())
	environment := &testEnvironment{server: server, http: httpServer, databaseURL: config.DatabaseURL}
	t.Cleanup(environment.close)
	return environment
}

func (e *testEnvironment) close() {
	e.closeOnce.Do(func() {
		e.server.Close()
		e.http.Close()
	})
}

type pairedConnector struct {
	connection  *websocket.Conn
	deviceID    string
	deviceToken string
	fingerprint string
}

func pairConnector(t *testing.T, environment *testEnvironment) pairedConnector {
	t.Helper()
	return pairConnectorWithScopes(t, environment, []string{"read", "prompt", "cancel"})
}

func pairConnectorWithScopes(t *testing.T, environment *testEnvironment, scopes []string) pairedConnector {
	t.Helper()
	code := createPairingCode(t, environment)
	connection := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", "")
	t.Cleanup(func() { _ = connection.Close(websocket.StatusNormalClosure, "test complete") })
	writeTestFrame(t, connection, protocol.PairStart{
		V: protocol.Version, Type: protocol.TypePairStart, RequestID: "pair-start-1",
		PairingCode: code.Code, DeviceName: "Integration Desktop", ConnectorVersion: "0.1.0",
	})
	challenge := readTestFrame[protocol.PairChallenge](t, connection)
	if challenge.Type != protocol.TypePairChallenge || challenge.DeviceID == "" || challenge.PairingToken == "" || challenge.Fingerprint == "" {
		t.Fatalf("invalid pair.challenge: %+v", challenge)
	}
	writeTestFrame(t, connection, protocol.PairAuthorize{
		V: protocol.Version, Type: protocol.TypePairAuthorize, RequestID: "pair-authorize-1",
		PairingToken: challenge.PairingToken,
		Workspaces:   []protocol.Workspace{{ID: "ws-1", Name: "Project", Path: "/tmp/project"}},
		Scopes:       scopes,
	})
	complete := readTestFrame[protocol.PairComplete](t, connection)
	if complete.Type != protocol.TypePairComplete || complete.DeviceID != challenge.DeviceID || complete.DeviceToken == "" || complete.Fingerprint != challenge.Fingerprint {
		t.Fatalf("invalid pair.complete: %+v", complete)
	}
	return pairedConnector{connection: connection, deviceID: complete.DeviceID, deviceToken: complete.DeviceToken, fingerprint: complete.Fingerprint}
}

func createPairingCode(t *testing.T, environment *testEnvironment) protocol.DesktopCodeResponse {
	t.Helper()
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/pairing/desktop-codes", testBootstrapToken, nil)
	if status != http.StatusCreated {
		t.Fatalf("create pairing code status=%d body=%s", status, body)
	}
	var response protocol.DesktopCodeResponse
	decodeTestJSON(t, body, &response)
	if response.Code == "" || response.ServerURL != "http://server.test" || response.ExpiresAt.IsZero() || time.Until(response.ExpiresAt) > 10*time.Minute {
		t.Fatalf("invalid pairing code response: %+v", response)
	}
	return response
}

func TestPairingPersistsOnlyTokenHashesAndReconnects(t *testing.T) {
	environment := newTestEnvironment(t)
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/pairing/desktop-codes", "", nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)

	connector := pairConnector(t, environment)
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/devices", testBootstrapToken, nil)
	if status != http.StatusOK {
		t.Fatalf("GET devices status=%d body=%s", status, body)
	}
	var devices protocol.DeviceListResponse
	decodeTestJSON(t, body, &devices)
	if len(devices.Devices) != 1 || devices.Devices[0].Status != "online" || devices.Devices[0].DeviceID != connector.deviceID || len(devices.Devices[0].Workspaces) != 1 {
		t.Fatalf("unexpected devices: %+v", devices)
	}

	// Secrets must never reach the database in plaintext: scan every text column
	// of the device table for the live tokens.
	db, err := sql.Open("pgx", environment.databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.QueryContext(context.Background(),
		`SELECT coalesce(string_agg(t::text, ' '), '') FROM devices t`)
	if err != nil {
		t.Fatal(err)
	}
	var persisted string
	if rows.Next() {
		if err := rows.Scan(&persisted); err != nil {
			rows.Close()
			t.Fatal(err)
		}
	}
	rows.Close()
	if strings.Contains(persisted, connector.deviceToken) {
		t.Fatal("plaintext device token was persisted")
	}
	if strings.Contains(persisted, "dpt_") {
		t.Fatal("plaintext pairing token was persisted")
	}
	if !strings.Contains(persisted, connector.deviceID) {
		t.Fatal("device row was not persisted")
	}

	reconnected := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", connector.deviceToken)
	defer reconnected.Close(websocket.StatusNormalClosure, "test complete")
	deadline := time.Now().Add(time.Second)
	for environment.server.hub.Get(connector.deviceID) == nil && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if environment.server.hub.Get(connector.deviceID) == nil {
		t.Fatal("device token reconnect did not register online Connector")
	}
}

func TestPairingCodeReuseAndExpiryRejected(t *testing.T) {
	environment := newTestEnvironment(t)
	code := createPairingCode(t, environment)
	first := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", "")
	writeTestFrame(t, first, protocol.PairStart{V: 1, Type: protocol.TypePairStart, RequestID: "start-first", PairingCode: code.Code, DeviceName: "One", ConnectorVersion: "0.1.0"})
	challenge := readTestFrame[protocol.PairChallenge](t, first)
	if challenge.DeviceID == "" {
		t.Fatal("first pair.start failed")
	}
	_ = first.Close(websocket.StatusNormalClosure, "disconnect before authorization")

	second := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", "")
	defer second.Close(websocket.StatusNormalClosure, "test complete")
	writeTestFrame(t, second, protocol.PairStart{V: 1, Type: protocol.TypePairStart, RequestID: "start-reuse", PairingCode: code.Code, DeviceName: "Two", ConnectorVersion: "0.1.0"})
	reused := readTestFrame[protocol.ErrorEnvelope](t, second)
	if reused.Error.Code != protocol.CodePairingCodeUsed {
		t.Fatalf("reused code error=%+v", reused.Error)
	}

	expiring := newTestEnvironment(t, func(config *Config) { config.PairingCodeTTL = 10 * time.Millisecond })
	expiredCode := createPairingCode(t, expiring)
	time.Sleep(40 * time.Millisecond)
	third := dialWebSocket(t, expiring.http.URL, "/v1/connector/ws", "")
	defer third.Close(websocket.StatusNormalClosure, "test complete")
	writeTestFrame(t, third, protocol.PairStart{V: 1, Type: protocol.TypePairStart, RequestID: "start-expired", PairingCode: expiredCode.Code, DeviceName: "Three", ConnectorVersion: "0.1.0"})
	expired := readTestFrame[protocol.ErrorEnvelope](t, third)
	if expired.Error.Code != protocol.CodePairingCodeExpired {
		t.Fatalf("expired code error=%+v", expired.Error)
	}
}

func TestUnauthorizedCannotIssueCommandsOrReadREST(t *testing.T) {
	environment := newTestEnvironment(t)
	connection := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", "")
	defer connection.Close(websocket.StatusNormalClosure, "test complete")
	writeTestFrame(t, connection, protocol.Command{V: 1, Type: protocol.TypeCommand, RequestID: "unauthorized-command", Method: protocol.MethodSessionList, Params: json.RawMessage(`{}`), TimeoutMS: 1000})
	response := readTestFrame[protocol.ErrorEnvelope](t, connection)
	if response.Error.Code != protocol.CodeUnauthorized {
		t.Fatalf("unauthorized command error=%+v", response.Error)
	}
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/sessions?deviceId=dev_unknown", "", nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
}

func TestWaitingDesktopAuthorizationCannotIssueCommands(t *testing.T) {
	environment := newTestEnvironment(t)
	code := createPairingCode(t, environment)
	connection := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", "")
	defer connection.Close(websocket.StatusNormalClosure, "test complete")
	writeTestFrame(t, connection, protocol.PairStart{V: 1, Type: protocol.TypePairStart, RequestID: "waiting-start", PairingCode: code.Code, DeviceName: "Waiting", ConnectorVersion: "0.1.0"})
	challenge := readTestFrame[protocol.PairChallenge](t, connection)
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/devices", testBootstrapToken, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte("waiting_desktop_authorization")) {
		t.Fatalf("waiting device status=%d body=%s", status, body)
	}
	writeTestFrame(t, connection, protocol.Command{V: 1, Type: protocol.TypeCommand, RequestID: "waiting-command", Method: protocol.MethodSessionList, Params: json.RawMessage(`{}`), TimeoutMS: 1000})
	response := readTestFrame[protocol.ErrorEnvelope](t, connection)
	if response.Error.Code != protocol.CodeUnauthorized || challenge.DeviceID == "" {
		t.Fatalf("waiting authorization command error=%+v", response.Error)
	}
}

func TestWaitingDesktopAuthorizationControlRequestDoesNotDropChallenge(t *testing.T) {
	environment := newTestEnvironment(t)
	code := createPairingCode(t, environment)
	connection := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", "")
	defer connection.Close(websocket.StatusNormalClosure, "test complete")
	writeTestFrame(t, connection, protocol.PairStart{V: 1, Type: protocol.TypePairStart, RequestID: "waiting-control-start", PairingCode: code.Code, DeviceName: "Waiting Control", ConnectorVersion: "0.1.0"})
	challenge := readTestFrame[protocol.PairChallenge](t, connection)

	// A panel may ask for an authenticated-only capability while the transport
	// is open. Reject the request without destroying the valid pairing challenge.
	writeTestFrame(t, connection, protocol.ConnectorRequest{V: 1, Type: protocol.TypeRequest, RequestID: "waiting-control-request", Method: "mobile.access.list", Params: json.RawMessage(`{}`)})
	response := readTestFrame[protocol.ErrorEnvelope](t, connection)
	if response.Error.Code != protocol.CodeUnauthorized {
		t.Fatalf("waiting control request error=%+v", response.Error)
	}
	writeTestFrame(t, connection, protocol.PairAuthorize{
		V: 1, Type: protocol.TypePairAuthorize, RequestID: "waiting-control-authorize", PairingToken: challenge.PairingToken,
		Workspaces: []protocol.Workspace{{ID: "ws-1", Name: "Project", Path: "/tmp/project"}}, Scopes: []string{"read"},
	})
	complete := readTestFrame[protocol.PairComplete](t, connection)
	if complete.Type != protocol.TypePairComplete || complete.DeviceID != challenge.DeviceID || complete.DeviceToken == "" {
		t.Fatalf("challenge was lost after control request: %+v", complete)
	}
}

func TestPairingAuthorizeReportsHubShutdown(t *testing.T) {
	environment := newTestEnvironment(t)
	code := createPairingCode(t, environment)
	connection := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", "")
	defer connection.Close(websocket.StatusNormalClosure, "test complete")
	writeTestFrame(t, connection, protocol.PairStart{
		V: 1, Type: protocol.TypePairStart, RequestID: "shutdown-start", PairingCode: code.Code, DeviceName: "Shutdown", ConnectorVersion: "0.1.0",
	})
	challenge := readTestFrame[protocol.PairChallenge](t, connection)
	environment.server.hub.CloseAll()
	writeTestFrame(t, connection, protocol.PairAuthorize{
		V: 1, Type: protocol.TypePairAuthorize, RequestID: "shutdown-authorize", PairingToken: challenge.PairingToken,
		Workspaces: []protocol.Workspace{{ID: "ws-1", Name: "Project", Path: "/tmp/project"}}, Scopes: []string{"read"},
	})
	response := readTestFrame[protocol.ErrorEnvelope](t, connection)
	if response.Error.Code != protocol.CodeInternalError || !response.Error.Retryable {
		t.Fatalf("hub shutdown authorization error code=%q retryable=%t", response.Error.Code, response.Error.Retryable)
	}
}

func TestPairingStoreErrorDoesNotMisclassifyInternalFailures(t *testing.T) {
	commandError := pairingStoreError(fmt.Errorf("database unavailable"))
	if commandError.Code != protocol.CodeInternalError || !commandError.Retryable {
		t.Fatalf("internal pairing error code=%q retryable=%t", commandError.Code, commandError.Retryable)
	}
}

func TestSessionListRoutesOverAuthorizedConnector(t *testing.T) {
	environment := newTestEnvironment(t)
	connector := pairConnector(t, environment)
	commands := make(chan protocol.Command, 1)
	errors := make(chan error, 1)
	go func() {
		command, err := readWS[protocol.Command](connector.connection)
		if err != nil {
			errors <- err
			return
		}
		commands <- command
		errors <- writeWS(connector.connection, protocol.Result{V: 1, Type: protocol.TypeResult, RequestID: command.RequestID, Result: json.RawMessage(`{"sessions":[{"id":"s1","title":"Routed","workspaceId":"ws-1","status":"idle","updatedAt":"2026-10-27T00:00:00Z"}]}`)})
	}()

	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/sessions?deviceId="+connector.deviceID+"&workspaceId=ws-1", testBootstrapToken, nil)
	if status != http.StatusOK {
		t.Fatalf("list status=%d body=%s", status, body)
	}
	var result protocol.SessionListResult
	decodeTestJSON(t, body, &result)
	if len(result.Sessions) != 1 || !bytes.Contains(result.Sessions[0], []byte(`"Routed"`)) {
		t.Fatalf("unexpected list result: %s", body)
	}
	select {
	case command := <-commands:
		if command.Method != protocol.MethodSessionList || command.TimeoutMS <= 0 || command.RequestID == "" || !bytes.Contains(command.Params, []byte(`"workspaceId":"ws-1"`)) {
			t.Fatalf("unexpected routed command: %+v", command)
		}
	case <-time.After(time.Second):
		t.Fatal("Connector did not receive session.list")
	}
	if err := <-errors; err != nil {
		t.Fatalf("Connector script: %v", err)
	}
}

func TestCreatePageAndCancelRouteParams(t *testing.T) {
	environment := newTestEnvironment(t)
	connector := pairConnector(t, environment)
	commands := make(chan protocol.Command, 3)
	scriptErrors := make(chan error, 1)
	go func() {
		for index := 0; index < 3; index++ {
			command, err := readWS[protocol.Command](connector.connection)
			if err != nil {
				scriptErrors <- err
				return
			}
			commands <- command
			result := json.RawMessage(fmt.Sprintf(`{"method":%q}`, command.Method))
			if err := writeWS(connector.connection, protocol.Result{V: 1, Type: protocol.TypeResult, RequestID: command.RequestID, Result: result}); err != nil {
				scriptErrors <- err
				return
			}
		}
		scriptErrors <- nil
	}()

	createRequest := protocol.SessionCreateRequest{RequestID: "create-1", DeviceID: connector.deviceID, WorkspaceID: "ws-1"}
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions", testBootstrapToken, createRequest)
	if status != http.StatusOK || !bytes.Contains(body, []byte(protocol.MethodSessionCreate)) {
		t.Fatalf("create status=%d body=%s", status, body)
	}
	create := <-commands
	if create.Method != protocol.MethodSessionCreate || !bytes.Contains(create.Params, []byte(`"workspaceId":"ws-1"`)) || bytes.Contains(create.Params, []byte(`"title"`)) {
		t.Fatalf("create command=%+v", create)
	}

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/sessions/s1/page?deviceId="+connector.deviceID+"&cursor=abc&limit=25", testBootstrapToken, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(protocol.MethodSessionPage)) {
		t.Fatalf("page status=%d body=%s", status, body)
	}
	page := <-commands
	var pageParams map[string]any
	decodeTestJSON(t, page.Params, &pageParams)
	if page.Method != protocol.MethodSessionPage || pageParams["sessionId"] != "s1" || pageParams["cursor"] != "abc" || pageParams["limit"] != float64(25) {
		t.Fatalf("page command=%+v params=%v", page, pageParams)
	}

	cancelRequest := protocol.SessionCancelRequest{RequestID: "cancel-1", DeviceID: connector.deviceID}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions/s1/cancel", testBootstrapToken, cancelRequest)
	if status != http.StatusOK || !bytes.Contains(body, []byte(protocol.MethodSessionCancel)) {
		t.Fatalf("cancel status=%d body=%s", status, body)
	}
	cancel := <-commands
	if cancel.Method != protocol.MethodSessionCancel || !bytes.Contains(cancel.Params, []byte(`"sessionId":"s1"`)) || bytes.Contains(cancel.Params, []byte(`"reason"`)) {
		t.Fatalf("cancel command=%+v", cancel)
	}
	if err := <-scriptErrors; err != nil {
		t.Fatalf("Connector script: %v", err)
	}
}

func TestCreateUsesDurableIdempotency(t *testing.T) {
	environment := newTestEnvironment(t)
	connector := pairConnector(t, environment)
	request := protocol.SessionCreateRequest{RequestID: "create-idempotency-1", DeviceID: connector.deviceID, WorkspaceID: "ws-1"}
	commandErr := make(chan error, 1)
	go func() {
		commandErr <- answerCommand(connector.connection, protocol.MethodSessionCreate, map[string]any{
			"sessionId": "created-once", "workspaceId": "ws-1",
		})
	}()
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions", testBootstrapToken, request)
	if err := <-commandErr; err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("create status=%d body=%s", status, body)
	}
	firstBody := append([]byte(nil), body...)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions", testBootstrapToken, request)
	if status != http.StatusOK || !bytes.Contains(body, []byte("created-once")) {
		t.Fatalf("create replay status=%d body=%s", status, body)
	}
	changed := request
	changed.WorkspaceID = "ws-2"
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions", testBootstrapToken, changed)
	assertErrorResponse(t, status, body, http.StatusConflict, protocol.CodeIdempotencyConflict)

	environment.close()
	_ = connector.connection.Close(websocket.StatusNormalClosure, "restart")
	restarted, err := New(context.Background(), Config{BootstrapToken: testBootstrapToken, DatabaseURL: environment.databaseURL, ServerURL: "http://server.test"})
	if err != nil {
		t.Fatalf("restart New() error: %v", err)
	}
	defer restarted.Close()
	restartedHTTP := httptest.NewServer(restarted.Handler())
	defer restartedHTTP.Close()
	status, persisted := testRequest(t, http.MethodPost, restartedHTTP.URL+"/v1/sessions", testBootstrapToken, request)
	if status != http.StatusOK || !bytes.Equal(firstBody, persisted) {
		t.Fatalf("persisted create retry without Connector status=%d body=%s", status, persisted)
	}
}

func TestDeprecatedCreateTitleAndCancelReasonRejected(t *testing.T) {
	environment := newTestEnvironment(t)
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions", testBootstrapToken, map[string]any{
		"requestId": "create-with-title", "deviceId": "dev-1", "workspaceId": "ws-1", "title": "unsupported",
	})
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions/s1/cancel", testBootstrapToken, map[string]any{
		"requestId": "cancel-with-reason", "deviceId": "dev-1", "reason": "unsupported",
	})
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)
}

func TestPromptConcurrentAndPersistedIdempotency(t *testing.T) {
	environment := newTestEnvironment(t)
	connector := pairConnector(t, environment)
	const requestID = "prompt-idempotency-1"
	received := make(chan struct{})
	release := make(chan struct{})
	commands := make(chan protocol.Command, 8)
	var commandCount atomic.Int32
	scriptErrors := make(chan error, 1)
	go func() {
		for {
			command, err := readWS[protocol.Command](connector.connection)
			if err != nil {
				scriptErrors <- err
				return
			}
			commandCount.Add(1)
			commands <- command
			if commandCount.Load() == 1 {
				close(received)
				<-release
			}
			if err := writeWS(connector.connection, protocol.Result{V: 1, Type: protocol.TypeResult, RequestID: command.RequestID, Result: json.RawMessage(fmt.Sprintf(`{"sessionId":"s1","requestId":%q,"status":"accepted"}`, command.RequestID))}); err != nil {
				scriptErrors <- err
				return
			}
		}
	}()

	request := protocol.SessionPromptRequest{RequestID: requestID, DeviceID: connector.deviceID, Mode: "queue", Content: []protocol.ContentPart{{Type: "text", Text: "fix the tests"}}}
	type httpOutcome struct {
		status int
		body   []byte
	}
	firstDone := make(chan httpOutcome, 1)
	go func() {
		status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions/s1/prompt", testBootstrapToken, request)
		firstDone <- httpOutcome{status: status, body: body}
	}()
	select {
	case <-received:
	case <-time.After(time.Second):
		t.Fatal("first prompt was not forwarded")
	}
	firstCommand := <-commands
	if firstCommand.Method != protocol.MethodSessionPrompt || firstCommand.RequestID != requestID {
		t.Fatalf("unexpected prompt command: %+v", firstCommand)
	}

	secondDone := make(chan httpOutcome, 1)
	go func() {
		status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions/s1/prompt", testBootstrapToken, request)
		secondDone <- httpOutcome{status: status, body: body}
	}()
	select {
	case outcome := <-secondDone:
		t.Fatalf("concurrent duplicate returned before first result: %+v", outcome)
	case <-time.After(80 * time.Millisecond):
	}
	close(release)
	first := <-firstDone
	second := <-secondDone
	if first.status != http.StatusOK || second.status != http.StatusOK || !bytes.Equal(first.body, second.body) || !bytes.Contains(first.body, []byte(`"accepted"`)) {
		t.Fatalf("idempotent responses first=%d %s second=%d %s", first.status, first.body, second.status, second.body)
	}

	status, third := testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions/s1/prompt", testBootstrapToken, request)
	if status != http.StatusOK || !bytes.Equal(first.body, third) {
		t.Fatalf("completed retry status=%d body=%s", status, third)
	}
	time.Sleep(80 * time.Millisecond)
	if got := commandCount.Load(); got != 1 {
		t.Fatalf("prompt was forwarded %d times; want 1", got)
	}

	changed := request
	changed.Content = []protocol.ContentPart{{Type: "text", Text: "different"}}
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions/s1/prompt", testBootstrapToken, changed)
	assertErrorResponse(t, status, body, http.StatusConflict, protocol.CodeIdempotencyConflict)

	environment.close()
	_ = connector.connection.Close(websocket.StatusNormalClosure, "restart")
	restarted, err := New(context.Background(), Config{BootstrapToken: testBootstrapToken, DatabaseURL: environment.databaseURL, ServerURL: "http://server.test"})
	if err != nil {
		t.Fatalf("restart New() error: %v", err)
	}
	defer restarted.Close()
	restartedHTTP := httptest.NewServer(restarted.Handler())
	defer restartedHTTP.Close()
	status, persisted := testRequest(t, http.MethodPost, restartedHTTP.URL+"/v1/sessions/s1/prompt", testBootstrapToken, request)
	if status != http.StatusOK || !bytes.Equal(first.body, persisted) {
		t.Fatalf("persisted retry without Connector status=%d body=%s", status, persisted)
	}
}

func TestCreateOfflineBeforeSubmissionCanRetryAfterReconnect(t *testing.T) {
	environment := newTestEnvironment(t)
	connector := pairConnector(t, environment)
	request := protocol.SessionCreateRequest{RequestID: "create-offline-retry", DeviceID: connector.deviceID, WorkspaceID: "ws-1"}
	_ = connector.connection.Close(websocket.StatusNormalClosure, "offline before create")
	deadline := time.Now().Add(time.Second)
	for environment.server.hub.Get(connector.deviceID) != nil && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if environment.server.hub.Get(connector.deviceID) != nil {
		t.Fatal("Connector did not leave the hub")
	}
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions", testBootstrapToken, request)
	assertErrorResponse(t, status, body, http.StatusServiceUnavailable, protocol.CodeDeviceOffline)
	if _, ok, _ := environment.server.store.Idempotency(context.Background(), request.RequestID); ok {
		t.Fatal("create that never reached a Connector was persisted as a completed outcome")
	}

	reconnected := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", connector.deviceToken)
	defer reconnected.Close(websocket.StatusNormalClosure, "test complete")
	commandErr := make(chan error, 1)
	go func() {
		commandErr <- answerCommand(reconnected, protocol.MethodSessionCreate, map[string]any{
			"sessionId": "created-after-reconnect", "workspaceId": "ws-1",
		})
	}()
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions", testBootstrapToken, request)
	if err := <-commandErr; err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK || !bytes.Contains(body, []byte("created-after-reconnect")) {
		t.Fatalf("reconnected create retry status=%d body=%s", status, body)
	}
}

func TestPromptOfflineBeforeSubmissionCanRetryAfterReconnect(t *testing.T) {
	environment := newTestEnvironment(t)
	connector := pairConnector(t, environment)
	request := protocol.SessionPromptRequest{RequestID: "prompt-offline-retry", DeviceID: connector.deviceID, Mode: "queue", Content: []protocol.ContentPart{{Type: "text", Text: "retry after reconnect"}}}

	_ = connector.connection.Close(websocket.StatusNormalClosure, "offline before prompt")
	deadline := time.Now().Add(time.Second)
	for environment.server.hub.Get(connector.deviceID) != nil && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if environment.server.hub.Get(connector.deviceID) != nil {
		t.Fatal("Connector did not leave the hub")
	}

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions/s1/prompt", testBootstrapToken, request)
	assertErrorResponse(t, status, body, http.StatusServiceUnavailable, protocol.CodeDeviceOffline)
	var offline protocol.ErrorResponse
	decodeTestJSON(t, body, &offline)
	var details struct {
		Submitted *bool `json:"submitted"`
	}
	decodeTestJSON(t, offline.Error.Details, &details)
	if details.Submitted == nil || *details.Submitted {
		t.Fatalf("unsubmitted offline details=%s; want submitted=false", offline.Error.Details)
	}
	if _, ok, _ := environment.server.store.Idempotency(context.Background(), request.RequestID); ok {
		t.Fatal("prompt that never reached a Connector was persisted as a completed outcome")
	}

	reconnected := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", connector.deviceToken)
	defer reconnected.Close(websocket.StatusNormalClosure, "test complete")
	commands := make(chan protocol.Command, 1)
	scriptErrors := make(chan error, 1)
	go func() {
		command, err := readWS[protocol.Command](reconnected)
		if err != nil {
			scriptErrors <- err
			return
		}
		commands <- command
		scriptErrors <- writeWS(reconnected, protocol.Result{V: 1, Type: protocol.TypeResult, RequestID: command.RequestID, Result: json.RawMessage(`{"sessionId":"s1","requestId":"prompt-offline-retry","status":"accepted"}`)})
	}()

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions/s1/prompt", testBootstrapToken, request)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"accepted"`)) {
		t.Fatalf("reconnected retry status=%d body=%s", status, body)
	}
	command := <-commands
	if command.Method != protocol.MethodSessionPrompt || command.RequestID != request.RequestID {
		t.Fatalf("retry command=%+v", command)
	}
	if err := <-scriptErrors; err != nil {
		t.Fatalf("reconnected Connector script: %v", err)
	}
	if record, ok, _ := environment.server.store.Idempotency(context.Background(), request.RequestID); !ok || record.Error != nil || !bytes.Contains(record.Result, []byte(`"accepted"`)) {
		t.Fatalf("successful retry idempotency=%+v, %v", record, ok)
	}
}

func TestPromptTimeoutRemainsPersisted(t *testing.T) {
	environment := newTestEnvironment(t)
	connector := pairConnector(t, environment)
	commands := make(chan protocol.Command, 2)
	go func() {
		for {
			command, err := readWS[protocol.Command](connector.connection)
			if err != nil {
				return
			}
			commands <- command
		}
	}()
	request := protocol.SessionPromptRequest{RequestID: "prompt-timeout-retry", DeviceID: connector.deviceID, Mode: "queue", Content: []protocol.ContentPart{{Type: "text", Text: "do not duplicate"}}, TimeoutMS: 50}

	status, first := testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions/s1/prompt", testBootstrapToken, request)
	assertErrorResponse(t, status, first, http.StatusGatewayTimeout, protocol.CodeCommandTimeout)
	select {
	case command := <-commands:
		if command.RequestID != request.RequestID {
			t.Fatalf("timed-out command=%+v", command)
		}
	case <-time.After(time.Second):
		t.Fatal("timed-out prompt was not submitted")
	}
	if record, ok, _ := environment.server.store.Idempotency(context.Background(), request.RequestID); !ok || record.Error == nil || record.Error.Code != protocol.CodeCommandTimeout {
		t.Fatalf("uncertain timeout idempotency=%+v, %v", record, ok)
	}

	status, second := testRequest(t, http.MethodPost, environment.http.URL+"/v1/sessions/s1/prompt", testBootstrapToken, request)
	assertErrorResponse(t, status, second, http.StatusGatewayTimeout, protocol.CodeCommandTimeout)
	if !bytes.Equal(first, second) {
		t.Fatalf("persisted timeout retry first=%s second=%s", first, second)
	}
	select {
	case duplicate := <-commands:
		t.Fatalf("persisted timeout was submitted again: %+v", duplicate)
	case <-time.After(80 * time.Millisecond):
	}
}

func TestOfflineAndCommandTimeout(t *testing.T) {
	t.Run("offline fails immediately", func(t *testing.T) {
		environment := newTestEnvironment(t)
		connector := pairConnector(t, environment)
		_ = connector.connection.Close(websocket.StatusNormalClosure, "offline test")
		deadline := time.Now().Add(time.Second)
		for environment.server.hub.Get(connector.deviceID) != nil && time.Now().Before(deadline) {
			time.Sleep(time.Millisecond)
		}
		started := time.Now()
		status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/sessions?deviceId="+connector.deviceID, testBootstrapToken, nil)
		assertErrorResponse(t, status, body, http.StatusServiceUnavailable, protocol.CodeDeviceOffline)
		if time.Since(started) > 500*time.Millisecond {
			t.Fatalf("offline command was not fast: %s", time.Since(started))
		}
	})

	t.Run("timeout", func(t *testing.T) {
		environment := newTestEnvironment(t, func(config *Config) { config.CommandTimeout = 60 * time.Millisecond })
		connector := pairConnector(t, environment)
		received := make(chan struct{})
		go func() {
			if _, err := readWS[protocol.Command](connector.connection); err == nil {
				close(received)
			}
		}()
		status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/sessions?deviceId="+connector.deviceID, testBootstrapToken, nil)
		assertErrorResponse(t, status, body, http.StatusGatewayTimeout, protocol.CodeCommandTimeout)
		select {
		case <-received:
		case <-time.After(time.Second):
			t.Fatal("timed-out command never reached Connector")
		}
	})
}

type observedFollowCommand struct {
	command        protocol.Command
	followID       string
	activeFollowID string
}

func observeFollowCommands(connection *websocket.Conn, observed chan<- observedFollowCommand, scriptErrors chan<- error) {
	activeFollowID := ""
	for {
		command, err := readWS[protocol.Command](connection)
		if err != nil {
			scriptErrors <- err
			return
		}
		observation := observedFollowCommand{command: command}
		result := json.RawMessage(`{"unfollowed":true}`)
		switch command.Method {
		case protocol.MethodSessionFollow:
			var params protocol.SessionFollowParams
			if err := json.Unmarshal(command.Params, &params); err != nil {
				scriptErrors <- err
				return
			}
			observation.followID = params.FollowID
			activeFollowID = params.FollowID
			result = json.RawMessage(`{"sessionId":"s1","snapshot":{"title":"Recovered"}}`)
		case protocol.MethodSessionUnfollow:
			var params protocol.SessionUnfollowParams
			if err := json.Unmarshal(command.Params, &params); err != nil {
				scriptErrors <- err
				return
			}
			observation.followID = params.FollowID
			if activeFollowID == params.FollowID {
				activeFollowID = ""
			}
		default:
			scriptErrors <- fmt.Errorf("method=%s, want session.follow or session.unfollow", command.Method)
			return
		}
		observation.activeFollowID = activeFollowID
		observed <- observation
		if err := writeWS(connection, protocol.Result{V: 1, Type: protocol.TypeResult, RequestID: command.RequestID, Result: result}); err != nil {
			scriptErrors <- err
			return
		}
	}
}

func nextObservedFollowCommand(t *testing.T, observed <-chan observedFollowCommand, scriptErrors <-chan error) observedFollowCommand {
	t.Helper()
	select {
	case observation := <-observed:
		return observation
	case err := <-scriptErrors:
		t.Fatalf("Connector follow script: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for follow lifecycle command")
	}
	return observedFollowCommand{}
}

func TestEventWSCloseUnfollowsWithFollowID(t *testing.T) {
	environment := newTestEnvironment(t)
	connector := pairConnector(t, environment)
	observed := make(chan observedFollowCommand, 4)
	scriptErrors := make(chan error, 1)
	go observeFollowCommands(connector.connection, observed, scriptErrors)

	connection := dialWebSocket(t, environment.http.URL, "/v1/events/ws?deviceId="+connector.deviceID+"&sessionId=s1&cursor=42", testBootstrapToken)
	defer connection.Close(websocket.StatusNormalClosure, "test complete")
	if result := readTestFrame[protocol.FollowResult](t, connection); result.Type != protocol.TypeFollowResult || !bytes.Contains(result.Result, []byte("Recovered")) {
		t.Fatalf("follow.result=%+v", result)
	}
	follow := nextObservedFollowCommand(t, observed, scriptErrors)
	var followParams protocol.SessionFollowParams
	decodeTestJSON(t, follow.command.Params, &followParams)
	if followParams.SessionID != "s1" || followParams.FollowID == "" || followParams.Cursor != "42" || !followParams.Stream {
		t.Fatalf("follow params=%+v", followParams)
	}

	_ = connection.Close(websocket.StatusNormalClosure, "close triggers unfollow")
	unfollow := nextObservedFollowCommand(t, observed, scriptErrors)
	var unfollowParams protocol.SessionUnfollowParams
	decodeTestJSON(t, unfollow.command.Params, &unfollowParams)
	if unfollow.command.Method != protocol.MethodSessionUnfollow || unfollowParams.SessionID != "s1" || unfollowParams.FollowID != followParams.FollowID {
		t.Fatalf("unfollow command=%+v params=%+v; want followId %q", unfollow.command, unfollowParams, followParams.FollowID)
	}
	if unfollow.activeFollowID != "" {
		t.Fatalf("matching unfollow left active follow %q", unfollow.activeFollowID)
	}
}

func TestEventSupersededUnfollowDoesNotKillReplacement(t *testing.T) {
	environment := newTestEnvironment(t)
	connector := pairConnector(t, environment)
	observed := make(chan observedFollowCommand, 6)
	scriptErrors := make(chan error, 1)
	go observeFollowCommands(connector.connection, observed, scriptErrors)

	first := dialWebSocket(t, environment.http.URL, "/v1/events/ws?deviceId="+connector.deviceID+"&sessionId=s1&cursor=42", testBootstrapToken)
	defer first.Close(websocket.StatusNormalClosure, "test complete")
	_ = readTestFrame[protocol.FollowResult](t, first)
	firstFollow := nextObservedFollowCommand(t, observed, scriptErrors)
	if firstFollow.followID == "" || firstFollow.activeFollowID != firstFollow.followID {
		t.Fatalf("first follow observation=%+v", firstFollow)
	}

	second := dialWebSocket(t, environment.http.URL, "/v1/events/ws?deviceId="+connector.deviceID+"&sessionId=s1&cursor=99", testBootstrapToken)
	defer second.Close(websocket.StatusNormalClosure, "test complete")
	_ = readTestFrame[protocol.FollowResult](t, second)
	superseded := readTestFrame[protocol.ErrorEnvelope](t, first)
	if superseded.Error.Code != protocol.CodeFollowSuperseded {
		t.Fatalf("superseded WS error=%+v", superseded.Error)
	}

	var secondFollowID string
	oldUnfollowSeen := false
	activeFollowID := ""
	for secondFollowID == "" || !oldUnfollowSeen {
		observation := nextObservedFollowCommand(t, observed, scriptErrors)
		activeFollowID = observation.activeFollowID
		switch observation.command.Method {
		case protocol.MethodSessionFollow:
			var params protocol.SessionFollowParams
			decodeTestJSON(t, observation.command.Params, &params)
			if params.FollowID == firstFollow.followID || params.Cursor != "99" {
				t.Fatalf("replacement follow params=%+v", params)
			}
			secondFollowID = params.FollowID
		case protocol.MethodSessionUnfollow:
			if observation.followID != firstFollow.followID {
				t.Fatalf("old WS unfollow followId=%q; want %q", observation.followID, firstFollow.followID)
			}
			oldUnfollowSeen = true
		}
	}
	if activeFollowID != secondFollowID {
		t.Fatalf("old WS cleanup killed replacement: active=%q, want %q", activeFollowID, secondFollowID)
	}

	_ = second.Close(websocket.StatusNormalClosure, "close replacement")
	last := nextObservedFollowCommand(t, observed, scriptErrors)
	if last.command.Method != protocol.MethodSessionUnfollow || last.followID != secondFollowID || last.activeFollowID != "" {
		t.Fatalf("replacement cleanup observation=%+v", last)
	}
}

func dialWebSocket(t *testing.T, baseURL, path, token string) *websocket.Conn {
	t.Helper()
	header := http.Header{}
	if token != "" {
		header.Set("Authorization", "Bearer "+token)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	connection, response, err := websocket.Dial(ctx, strings.Replace(baseURL, "http://", "ws://", 1)+path, &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		status := 0
		if response != nil {
			status = response.StatusCode
		}
		t.Fatalf("WebSocket dial %s status=%d: %v", path, status, err)
	}
	return connection
}

func writeTestFrame(t *testing.T, connection *websocket.Conn, value any) {
	t.Helper()
	if err := writeWS(connection, value); err != nil {
		t.Fatalf("WebSocket write: %v", err)
	}
}

func writeWS(connection *websocket.Conn, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return connection.Write(ctx, websocket.MessageText, data)
}

func readTestFrame[T any](t *testing.T, connection *websocket.Conn) T {
	t.Helper()
	value, err := readWS[T](connection)
	if err != nil {
		t.Fatalf("WebSocket read: %v", err)
	}
	return value
}

func readWS[T any](connection *websocket.Conn) (T, error) {
	var value T
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	messageType, data, err := connection.Read(ctx)
	if err != nil {
		return value, err
	}
	if messageType != websocket.MessageText {
		return value, fmt.Errorf("message type=%v, want text", messageType)
	}
	err = json.Unmarshal(data, &value)
	return value, err
}

func testRequest(t *testing.T, method, url, token string, body any) (int, []byte) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(data)
	}
	request, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, data
}

func decodeTestJSON(t *testing.T, data []byte, destination any) {
	t.Helper()
	if err := json.Unmarshal(data, destination); err != nil {
		t.Fatalf("decode JSON %s: %v", data, err)
	}
}

func assertErrorResponse(t *testing.T, status int, body []byte, wantedStatus int, wantedCode string) {
	t.Helper()
	if status != wantedStatus {
		t.Fatalf("status=%d body=%s; want %d", status, body, wantedStatus)
	}
	var response protocol.ErrorResponse
	decodeTestJSON(t, body, &response)
	if response.V != 1 || response.Error.Code != wantedCode {
		t.Fatalf("error response=%+v; want code %s", response, wantedCode)
	}
}
