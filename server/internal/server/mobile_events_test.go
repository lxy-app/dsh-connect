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
