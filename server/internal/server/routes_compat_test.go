package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/go-chi/chi/v5"
)

func TestRouteTableCompatibility(t *testing.T) {
	expected := make(map[string]bool)
	add := func(method, path string) {
		expected[method+" "+path] = true
		if method == http.MethodGet {
			expected[http.MethodHead+" "+path] = true
		}
	}

	add(http.MethodPost, "/v1/admin/auth/login")
	add(http.MethodPost, "/v1/admin/auth/logout")
	add(http.MethodGet, "/v1/admin/auth/me")
	add(http.MethodGet, "/v1/admin/overview")
	add(http.MethodGet, "/v1/admin/sessions")
	add(http.MethodGet, "/v1/admin/interactions")
	add(http.MethodGet, "/v1/admin/approval-policy")
	add(http.MethodPatch, "/v1/admin/approval-policy")
	add(http.MethodGet, "/v1/admin/settings")
	add(http.MethodGet, "/v1/admin/users")
	add(http.MethodPost, "/v1/admin/users")
	add(http.MethodPatch, "/v1/admin/users/{userId}")
	add(http.MethodDelete, "/v1/admin/users/{userId}")
	add(http.MethodGet, "/v1/admin/users/{userId}/access-preview")
	add(http.MethodGet, "/v1/admin/policies")
	add(http.MethodPost, "/v1/admin/policies")
	add(http.MethodPatch, "/v1/admin/policies/{policyId}")
	add(http.MethodDelete, "/v1/admin/policies/{policyId}")
	add(http.MethodGet, "/v1/admin/devices")
	add(http.MethodPatch, "/v1/admin/devices/{deviceId}")
	add(http.MethodDelete, "/v1/admin/devices/{deviceId}")
	add(http.MethodPost, "/v1/admin/devices/{deviceId}/revoke")
	add(http.MethodGet, "/v1/admin/mobile-devices")
	add(http.MethodPost, "/v1/admin/mobile-devices/{mobileDeviceId}/revoke")
	add(http.MethodGet, "/v1/admin/audit")
	add(http.MethodPost, "/v1/admin/pairing-codes")
	add(http.MethodGet, "/v1/admin/pairing-codes")

	add(http.MethodPost, "/v1/mobile/auth/login")
	add(http.MethodPost, "/v1/mobile/auth/refresh")
	add(http.MethodPost, "/v1/mobile/auth/logout")
	add(http.MethodGet, "/v1/mobile/me")
	add(http.MethodGet, "/v1/mobile/events/ws")
	add(http.MethodGet, "/v1/mobile/access")
	add(http.MethodGet, "/v1/mobile/workspaces")
	add(http.MethodGet, "/v1/mobile/workspaces/{workspaceId}/model")
	add(http.MethodGet, "/v1/mobile/sessions")
	add(http.MethodPost, "/v1/mobile/sessions")
	add(http.MethodGet, "/v1/mobile/sessions/{sessionId}/messages")
	add(http.MethodGet, "/v1/mobile/sessions/{sessionId}/model")
	add(http.MethodPost, "/v1/mobile/sessions/{sessionId}/model")
	add(http.MethodPost, "/v1/mobile/sessions/{sessionId}/prompt")
	add(http.MethodPost, "/v1/mobile/sessions/{sessionId}/cancel")
	add(http.MethodPost, "/v1/mobile/sessions/{sessionId}/attachments")
	add(http.MethodGet, "/v1/mobile/interactions")
	add(http.MethodPost, "/v1/mobile/interactions/{interactionId}/decision")
	add(http.MethodGet, "/v1/mobile/attachments/{attachmentId}")
	add(http.MethodGet, "/v1/mobile/attachments/{attachmentId}/preview")

	add(http.MethodGet, "/v1/connector/ws")
	add(http.MethodPost, "/v1/connector/attachments/{attachmentId}")
	add(http.MethodGet, "/v1/connector/uploads/{attachmentId}")

	add(http.MethodPost, "/v1/pairing/desktop-codes")
	add(http.MethodGet, "/v1/devices")
	add(http.MethodGet, "/v1/sessions")
	add(http.MethodPost, "/v1/sessions")
	add(http.MethodGet, "/v1/sessions/{sessionId}/page")
	add(http.MethodPost, "/v1/sessions/{sessionId}/prompt")
	add(http.MethodPost, "/v1/sessions/{sessionId}/cancel")
	add(http.MethodGet, "/v1/events/ws")

	mux := chi.NewRouter()
	(&Server{}).registerAPIRoutes(mux)
	if err := chi.Walk(mux, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		key := method + " " + route
		if !expected[key] {
			t.Errorf("unexpected route %s", key)
			return nil
		}
		delete(expected, key)
		return nil
	}); err != nil {
		t.Fatalf("walk Chi routes: %v", err)
	}
	for route := range expected {
		t.Errorf("missing route %s", route)
	}
}

func TestHTTPRouteCompatibility(t *testing.T) {
	environment := newTestEnvironment(t)
	handler := environment.server.Handler()

	t.Run("GET routes continue to accept HEAD", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodHead, "/v1/admin/auth/me", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		assertErrorResponse(t, response.Code, response.Body.Bytes(), http.StatusUnauthorized, protocol.CodeUnauthorized)
	})

	t.Run("wrong method preserves 405 and Allow", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodPut, "/v1/admin/auth/me", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		if allow := response.Header().Get("Allow"); allow != "GET, HEAD" {
			t.Fatalf("Allow=%q; want GET, HEAD", allow)
		}
		if contentType := response.Header().Get("Content-Type"); contentType != "text/plain; charset=utf-8" {
			t.Fatalf("Content-Type=%q", contentType)
		}
		if body := response.Body.String(); body != "Method Not Allowed\n" {
			t.Fatalf("body=%q", body)
		}
	})

	t.Run("405 resolves methods through path parameters", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodPut, "/v1/admin/users/usr-1", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		if allow := response.Header().Get("Allow"); allow != "DELETE, PATCH" {
			t.Fatalf("Allow=%q; want DELETE, PATCH", allow)
		}
	})

	t.Run("unsupported method on an unknown path stays 404", func(t *testing.T) {
		request := httptest.NewRequest("PURGE", "/v1/not-a-route", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
	})

	t.Run("unknown and trailing slash paths stay 404", func(t *testing.T) {
		for _, path := range []string{
			"/v1/not-a-route",
			"/v1/admin/not-a-route",
			"/v1/mobile/not-a-route",
			"/v1/connector/not-a-route",
			"/v1/devices/",
		} {
			request := httptest.NewRequest(http.MethodGet, path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusNotFound {
				t.Fatalf("GET %s status=%d body=%s", path, response.Code, response.Body.String())
			}
		}
	})

	t.Run("non canonical paths redirect without losing the query", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/v1//devices?deviceId=dev-1", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusTemporaryRedirect {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		if location := response.Header().Get("Location"); location != "/v1/devices?deviceId=dev-1" {
			t.Fatalf("Location=%q", location)
		}
	})

	t.Run("OPTIONS stays ahead of routing and authentication", func(t *testing.T) {
		for _, test := range []struct {
			name         string
			path         string
			origin       string
			wantedOrigin string
		}{
			{name: "allowed loopback origin", path: "/v1/mobile/sessions", origin: "http://127.0.0.1:5173", wantedOrigin: "http://127.0.0.1:5173"},
			{name: "unknown route", path: "/v1/not-a-route", origin: "http://localhost:5173", wantedOrigin: "http://localhost:5173"},
			{name: "disallowed origin", path: "/v1/admin/users", origin: "https://untrusted.example"},
		} {
			t.Run(test.name, func(t *testing.T) {
				request := httptest.NewRequest(http.MethodOptions, test.path, nil)
				request.Header.Set("Origin", test.origin)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				if response.Code != http.StatusNoContent {
					t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
				}
				if origin := response.Header().Get("Access-Control-Allow-Origin"); origin != test.wantedOrigin {
					t.Fatalf("Access-Control-Allow-Origin=%q; want %q", origin, test.wantedOrigin)
				}
				if test.wantedOrigin != "" && response.Header().Get("Access-Control-Allow-Credentials") != "true" {
					t.Fatal("credentialed CORS response is missing Access-Control-Allow-Credentials")
				}
			})
		}
	})
}

func TestRouteCredentialBoundaries(t *testing.T) {
	environment := newAdminEnvironment(t)
	adminToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	phone := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Route compatibility phone")
	connector := pairConnector(t, environment.testEnvironment)

	for _, test := range []struct {
		name       string
		method     string
		path       string
		token      string
		wantStatus int
		wantCode   string
	}{
		{name: "admin session reaches Admin", method: http.MethodGet, path: "/v1/admin/overview", token: adminToken, wantStatus: http.StatusOK},
		{name: "bootstrap reaches Admin as owner", method: http.MethodGet, path: "/v1/admin/mobile-devices", token: testBootstrapToken, wantStatus: http.StatusOK},
		{name: "mobile token rejected by Admin", method: http.MethodGet, path: "/v1/admin/auth/me", token: phone.AccessToken, wantStatus: http.StatusUnauthorized, wantCode: protocol.CodeUnauthorized},
		{name: "connector token rejected by Admin", method: http.MethodGet, path: "/v1/admin/overview", token: connector.deviceToken, wantStatus: http.StatusUnauthorized, wantCode: protocol.CodeUnauthorized},
		{name: "admin session rejected by bootstrap debug", method: http.MethodGet, path: "/v1/devices", token: adminToken, wantStatus: http.StatusUnauthorized, wantCode: protocol.CodeUnauthorized},
		{name: "mobile token rejected by bootstrap debug", method: http.MethodGet, path: "/v1/devices", token: phone.AccessToken, wantStatus: http.StatusUnauthorized, wantCode: protocol.CodeUnauthorized},
		{name: "connector token rejected by bootstrap debug", method: http.MethodGet, path: "/v1/devices", token: connector.deviceToken, wantStatus: http.StatusUnauthorized, wantCode: protocol.CodeUnauthorized},
		{name: "bootstrap reaches bootstrap debug", method: http.MethodGet, path: "/v1/devices", token: testBootstrapToken, wantStatus: http.StatusOK},
		{name: "mobile token reaches Mobile", method: http.MethodGet, path: "/v1/mobile/me", token: phone.AccessToken, wantStatus: http.StatusOK},
		{name: "admin session rejected by Mobile", method: http.MethodGet, path: "/v1/mobile/me", token: adminToken, wantStatus: http.StatusUnauthorized, wantCode: protocol.CodeUnauthorized},
		{name: "bootstrap rejected by Mobile", method: http.MethodGet, path: "/v1/mobile/me", token: testBootstrapToken, wantStatus: http.StatusUnauthorized, wantCode: protocol.CodeUnauthorized},
		{name: "connector token rejected by Mobile", method: http.MethodGet, path: "/v1/mobile/me", token: connector.deviceToken, wantStatus: http.StatusUnauthorized, wantCode: protocol.CodeUnauthorized},
		{name: "ordinary Mobile REST rejects query token", method: http.MethodGet, path: "/v1/mobile/me?accessToken=" + phone.AccessToken, wantStatus: http.StatusUnauthorized, wantCode: protocol.CodeUnauthorized},
		{name: "Mobile WS accepts query token before upgrade", method: http.MethodGet, path: "/v1/mobile/events/ws?accessToken=" + phone.AccessToken, wantStatus: http.StatusBadRequest, wantCode: protocol.CodeInvalidRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			status, body := testRequest(t, test.method, environment.http.URL+test.path, test.token, nil)
			if test.wantCode != "" {
				assertErrorResponse(t, status, body, test.wantStatus, test.wantCode)
				return
			}
			if status != test.wantStatus {
				t.Fatalf("status=%d body=%s; want %d", status, body, test.wantStatus)
			}
		})
	}
}

func TestEscapedPathParameterReachesConnector(t *testing.T) {
	environment := newTestEnvironment(t)
	connector := pairConnector(t, environment)
	commands := make(chan protocol.Command, 1)
	scriptErrors := make(chan error, 1)
	go func() {
		command, err := readWS[protocol.Command](connector.connection)
		if err != nil {
			scriptErrors <- err
			return
		}
		commands <- command
		scriptErrors <- writeWS(connector.connection, protocol.Result{
			V: protocol.Version, Type: protocol.TypeResult, RequestID: command.RequestID,
			Result: json.RawMessage(`{"messages":[]}`),
		})
	}()

	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/sessions/sess%2Froute/page?deviceId="+connector.deviceID, testBootstrapToken, nil)
	if status != http.StatusOK {
		t.Fatalf("page status=%d body=%s", status, body)
	}
	command := <-commands
	if command.Method != protocol.MethodSessionPage {
		t.Fatalf("method=%q; want %q", command.Method, protocol.MethodSessionPage)
	}
	var params map[string]any
	decodeTestJSON(t, command.Params, &params)
	if params["sessionId"] != "sess/route" {
		t.Fatalf("sessionId=%v; want decoded sess/route", params["sessionId"])
	}
	if err := <-scriptErrors; err != nil {
		t.Fatalf("Connector script: %v", err)
	}
}
