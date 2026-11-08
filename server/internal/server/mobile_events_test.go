package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

func TestMobileEventsWebSocketStreamsAssistantDeltas(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	code := issueMobilePairingCode(t, environment, ownerToken, "")
	phone := pairMobile(t, environment, code.Code, "Stream iPhone")

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
		"deviceId": connector.deviceID, "workspaces": []string{"ws-1"}, "scopes": []string{"read"},
	})
	if status != http.StatusCreated {
		t.Fatalf("access request status=%d body=%s", status, body)
	}
	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessList, map[string]any{})
	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessDecide, map[string]any{
		"mobileDeviceId": phone.MobileDeviceID,
		"action":         "allow",
		"workspaces":     []string{"ws-1"},
		"scopes":         []string{"read"},
	})

	observed := make(chan protocol.SessionFollowParams, 1)
	followErr := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		messageType, data, err := connector.connection.Read(ctx)
		if err != nil {
			followErr <- err
			return
		}
		if messageType != websocket.MessageText {
			followErr <- errInvalidFrame
			return
		}
		var command connectorCommandFrame
		if err := json.Unmarshal(data, &command); err != nil {
			followErr <- err
			return
		}
		if command.Type != protocol.TypeCommand || command.Method != protocol.MethodSessionFollow {
			followErr <- errUnexpectedCommand
			return
		}
		var params protocol.SessionFollowParams
		if err := json.Unmarshal(command.Params, &params); err != nil {
			followErr <- err
			return
		}
		observed <- params
		payload, _ := json.Marshal(map[string]any{"accepted": true, "sessionId": "sess-1"})
		response, _ := json.Marshal(protocol.Result{
			V: protocol.Version, Type: protocol.TypeResult, RequestID: command.RequestID, Result: payload,
		})
		followErr <- connector.connection.Write(ctx, websocket.MessageText, response)
	}()

	connection := dialWebSocket(
		t,
		environment.http.URL,
		"/v1/mobile/events/ws?deviceId="+connector.deviceID+"&workspaceId=ws-1&sessionId=sess-1",
		phone.AccessToken,
	)
	defer connection.Close(websocket.StatusNormalClosure, "test complete")
	if result := readTestFrame[protocol.FollowResult](t, connection); result.Type != protocol.TypeFollowResult {
		t.Fatalf("follow.result=%+v", result)
	}
	if err := <-followErr; err != nil {
		t.Fatalf("connector follow answer: %v", err)
	}
	params := <-observed
	if !params.Compact || !params.Stream {
		t.Fatalf("mobile follow params=%+v; want compact streaming follow", params)
	}

	eventData, _ := json.Marshal(map[string]any{"phase": "delta", "text": "streamed", "attemptId": "a1"})
	writeTestFrame(t, connector.connection, protocol.Event{
		V: protocol.Version, Type: protocol.TypeEvent, EventID: "evt_stream_1",
		DeviceID: connector.deviceID, SessionID: "sess-1", Kind: "assistant.stream",
		OccurredAt: nowUTC(), Data: eventData,
	})
	frame := readTestFrame[protocol.Event](t, connection)
	if frame.Kind != "assistant.stream" || frame.SessionID != "sess-1" {
		t.Fatalf("mobile stream event=%+v", frame)
	}
	var data map[string]any
	if err := json.Unmarshal(frame.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data["phase"] != "delta" || data["text"] != "streamed" {
		t.Fatalf("mobile stream data=%v", data)
	}
}

func TestMobileEventsCloseWhenAccessIsRevoked(t *testing.T) {
	tests := []struct {
		name   string
		action func(t *testing.T, environment *adminEnvironment, ownerToken string, phone protocol.MobileSessionResponse)
	}{
		{
			name: "admin revokes phone",
			action: func(t *testing.T, environment *adminEnvironment, ownerToken string, phone protocol.MobileSessionResponse) {
				status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/mobile-devices/"+phone.MobileDeviceID+"/revoke", ownerToken, nil)
				if status != http.StatusOK {
					t.Fatalf("revoke phone status=%d body=%s", status, body)
				}
			},
		},
		{
			name: "phone logs out",
			action: func(t *testing.T, environment *adminEnvironment, _ string, phone protocol.MobileSessionResponse) {
				status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/logout", phone.AccessToken, nil)
				if status != http.StatusNoContent {
					t.Fatalf("mobile logout status=%d body=%s", status, body)
				}
			},
		},
		{
			name: "phone withdraws grant",
			action: func(t *testing.T, environment *adminEnvironment, _ string, phone protocol.MobileSessionResponse) {
				status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/access", phone.AccessToken, nil)
				if status != http.StatusOK {
					t.Fatalf("load access status=%d body=%s", status, body)
				}
				var access protocol.MobileAccessOverviewResponse
				decodeTestJSON(t, body, &access)
				if len(access.Desktops) != 1 || access.Desktops[0].Grant == nil {
					t.Fatalf("missing active grant: %+v", access)
				}
				status, body = testRequest(t, http.MethodDelete, environment.http.URL+"/v1/mobile/access/"+access.Desktops[0].Grant.GrantID, phone.AccessToken, nil)
				if status != http.StatusNoContent {
					t.Fatalf("revoke grant status=%d body=%s", status, body)
				}
			},
		},
		{
			name: "owner disables user",
			action: func(t *testing.T, environment *adminEnvironment, ownerToken string, phone protocol.MobileSessionResponse) {
				status, body := testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/users/"+phone.User.ID, ownerToken, map[string]string{"status": "disabled"})
				if status != http.StatusOK {
					t.Fatalf("disable user status=%d body=%s", status, body)
				}
			},
		},
		{
			name: "owner deletes user",
			action: func(t *testing.T, environment *adminEnvironment, ownerToken string, phone protocol.MobileSessionResponse) {
				status, body := testRequest(t, http.MethodDelete, environment.http.URL+"/v1/admin/users/"+phone.User.ID, ownerToken, nil)
				if status != http.StatusNoContent {
					t.Fatalf("delete user status=%d body=%s", status, body)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			environment := newAdminEnvironment(t)
			ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
			status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
				"email": "stream-member@example.com", "displayName": "Stream Member", "password": "member-password", "role": "member",
			})
			if status != http.StatusCreated {
				t.Fatalf("create stream member status=%d body=%s", status, body)
			}
			var member struct{ ID string }
			decodeTestJSON(t, body, &member)
			code := issueMobilePairingCode(t, environment, ownerToken, member.ID)
			phone := pairMobile(t, environment, code.Code, "Revocable iPhone")
			connection := openMobileEventStream(t, environment, phone)

			test.action(t, environment, ownerToken, phone)
			assertWebSocketClosed(t, connection)
		})
	}
}

func TestMobileEventsRevocationCancelsPendingFollow(t *testing.T) {
	environment := &adminEnvironment{testEnvironment: newTestEnvironment(t, func(config *Config) {
		config.BootstrapOwnerEmail = testOwnerEmail
		config.BootstrapOwnerPassword = testOwnerPassword
		config.BootstrapOwnerName = "Test Owner"
		config.CommandTimeout = 5 * time.Second
	})}
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	code := issueMobilePairingCode(t, environment, ownerToken, "")
	phone := pairMobile(t, environment, code.Code, "Pending Follow iPhone")
	connector := grantMobileReadAccess(t, environment, phone)

	followStarted := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		messageType, data, err := connector.connection.Read(ctx)
		if err != nil {
			followStarted <- err
			return
		}
		var command connectorCommandFrame
		if messageType != websocket.MessageText || json.Unmarshal(data, &command) != nil ||
			command.Type != protocol.TypeCommand || command.Method != protocol.MethodSessionFollow {
			followStarted <- errUnexpectedCommand
			return
		}
		followStarted <- nil
		// Deliberately leave session.follow unanswered. Revocation must cancel the
		// request rather than wait for the five-second command timeout.
	}()

	connection := dialWebSocket(
		t,
		environment.http.URL,
		"/v1/mobile/events/ws?deviceId="+connector.deviceID+"&workspaceId=ws-1&sessionId=sess-1",
		phone.AccessToken,
	)
	t.Cleanup(func() { _ = connection.Close(websocket.StatusNormalClosure, "test complete") })
	if err := <-followStarted; err != nil {
		t.Fatalf("connector did not receive pending follow: %v", err)
	}
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/mobile-devices/"+phone.MobileDeviceID+"/revoke", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("revoke phone status=%d body=%s", status, body)
	}
	assertWebSocketClosed(t, connection)
}

func TestMobileEventReauthorizationUsesCurrentIdentityState(t *testing.T) {
	tests := []struct {
		name   string
		revoke func(t *testing.T, environment *adminEnvironment, phone protocol.MobileSessionResponse)
	}{
		{
			name: "phone already revoked",
			revoke: func(t *testing.T, environment *adminEnvironment, phone protocol.MobileSessionResponse) {
				if err := environment.server.store.RevokeMobileDevice(context.Background(), phone.MobileDeviceID, nowUTC()); err != nil {
					t.Fatalf("revoke mobile device: %v", err)
				}
			},
		},
		{
			name: "user already disabled with grant intact",
			revoke: func(t *testing.T, environment *adminEnvironment, phone protocol.MobileSessionResponse) {
				status := store.UserStatusDisabled
				if _, err := environment.server.store.UpdateUser(context.Background(), phone.User.ID, store.UserUpdate{Status: &status}); err != nil {
					t.Fatalf("disable mobile user: %v", err)
				}
			},
		},
		{
			name: "user already deleted",
			revoke: func(t *testing.T, environment *adminEnvironment, phone protocol.MobileSessionResponse) {
				if err := environment.server.store.DeleteUser(context.Background(), phone.User.ID); err != nil {
					t.Fatalf("delete mobile user: %v", err)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			environment := newAdminEnvironment(t)
			ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
			status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
				"email": "stale-stream@example.com", "displayName": "Stale Stream", "password": "member-password", "role": "member",
			})
			if status != http.StatusCreated {
				t.Fatalf("create member status=%d body=%s", status, body)
			}
			var member struct{ ID string }
			decodeTestJSON(t, body, &member)
			code := issueMobilePairingCode(t, environment, ownerToken, member.ID)
			phone := pairMobile(t, environment, code.Code, "Stale iPhone")
			connector := grantMobileReadAccess(t, environment, phone)
			device, err := environment.server.store.MobileDeviceByID(context.Background(), phone.MobileDeviceID)
			if err != nil {
				t.Fatalf("load mobile device: %v", err)
			}
			user, err := environment.server.store.UserByID(context.Background(), phone.User.ID)
			if err != nil {
				t.Fatalf("load mobile user: %v", err)
			}
			actor := mobileActor{Device: device, User: user}
			request := httptest.NewRequest(http.MethodGet, "/v1/mobile/events/ws", nil)
			if commandError := environment.server.reauthorizeMobileEvent(request, connector.deviceID, "ws-1", "sess-1", actor); commandError != nil {
				t.Fatalf("initial reauthorization failed: %+v", commandError)
			}

			test.revoke(t, environment, phone)
			if commandError := environment.server.reauthorizeMobileEvent(request, connector.deviceID, "ws-1", "sess-1", actor); commandError == nil {
				t.Fatal("stale handshake actor bypassed current identity state")
			}
		})
	}
}

func grantMobileReadAccess(t *testing.T, environment *adminEnvironment, phone protocol.MobileSessionResponse) pairedConnector {
	t.Helper()
	connector := pairConnector(t, environment.testEnvironment)
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
		"deviceId": connector.deviceID, "workspaces": []string{"ws-1"}, "scopes": []string{"read"},
	})
	if status != http.StatusCreated {
		t.Fatalf("access request status=%d body=%s", status, body)
	}
	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessList, map[string]any{})
	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessDecide, map[string]any{
		"mobileDeviceId": phone.MobileDeviceID,
		"action":         "allow",
		"workspaces":     []string{"ws-1"},
		"scopes":         []string{"read"},
	})
	return connector
}

// openMobileEventStream completes the real grant and follow handshake before
// returning, so revocation tests observe an established mobile event socket.
func openMobileEventStream(t *testing.T, environment *adminEnvironment, phone protocol.MobileSessionResponse) *websocket.Conn {
	t.Helper()
	connector := grantMobileReadAccess(t, environment, phone)

	followErr := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		messageType, data, err := connector.connection.Read(ctx)
		if err != nil {
			followErr <- err
			return
		}
		if messageType != websocket.MessageText {
			followErr <- errInvalidFrame
			return
		}
		var command connectorCommandFrame
		if err := json.Unmarshal(data, &command); err != nil {
			followErr <- err
			return
		}
		if command.Type != protocol.TypeCommand || command.Method != protocol.MethodSessionFollow {
			followErr <- errUnexpectedCommand
			return
		}
		payload, _ := json.Marshal(map[string]any{"accepted": true, "sessionId": "sess-1"})
		response, _ := json.Marshal(protocol.Result{
			V: protocol.Version, Type: protocol.TypeResult, RequestID: command.RequestID, Result: payload,
		})
		followErr <- connector.connection.Write(ctx, websocket.MessageText, response)
	}()

	connection := dialWebSocket(
		t,
		environment.http.URL,
		"/v1/mobile/events/ws?deviceId="+connector.deviceID+"&workspaceId=ws-1&sessionId=sess-1",
		phone.AccessToken,
	)
	t.Cleanup(func() { _ = connection.Close(websocket.StatusNormalClosure, "test complete") })
	if result := readTestFrame[protocol.FollowResult](t, connection); result.Type != protocol.TypeFollowResult {
		t.Fatalf("follow.result=%+v", result)
	}
	if err := <-followErr; err != nil {
		t.Fatalf("connector follow answer: %v", err)
	}
	return connection
}

func assertWebSocketClosed(t *testing.T, connection *websocket.Conn) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		_, _, err := connection.Read(ctx)
		if err == nil {
			// The server may send a terminal protocol error before closing.
			continue
		}
		if ctx.Err() != nil {
			t.Fatalf("websocket remained open after revocation: %v", err)
		}
		return
	}
}
