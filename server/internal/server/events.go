package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
)

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	deviceID := r.URL.Query().Get("deviceId")
	sessionID := r.URL.Query().Get("sessionId")
	cursor := r.URL.Query().Get("cursor")
	if !validID(deviceID) || !validID(sessionID) || len(cursor) > 4096 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "deviceId and sessionId are required; cursor must be at most 4096 bytes", false))
		return
	}
	s.serveEvents(w, r, deviceID, sessionID, cursor, false)
}

// handleMobileEvents authenticates a paired phone, checks its workspace grant,
// and relays only display-safe streaming events. The mobile App has its own
// transcript via HTTP; this socket exists for live tokens and status changes.
func (s *Server) handleMobileEvents(w http.ResponseWriter, r *http.Request) {
	deviceID := r.URL.Query().Get("deviceId")
	workspaceID := r.URL.Query().Get("workspaceId")
	sessionID := r.URL.Query().Get("sessionId")
	cursor := r.URL.Query().Get("cursor")
	if !validID(deviceID) || !validID(workspaceID) || !validID(sessionID) || len(cursor) > 4096 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "deviceId, workspaceId and sessionId are required; cursor must be at most 4096 bytes", false))
		return
	}
	if _, commandError := s.authorizeMobileSession(r, deviceID, workspaceID, sessionID, "read"); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	s.serveEvents(w, r, deviceID, sessionID, cursor, true)
}

func (s *Server) serveEvents(w http.ResponseWriter, r *http.Request, deviceID, sessionID, cursor string, mobile bool) {
	timeout, commandError := s.queryTimeout(r)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	sub, ok := s.events.Subscribe(deviceID, sessionID)
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeDeviceOffline, "server is shutting down", true))
		return
	}
	defer s.events.Unsubscribe(sub)

	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	connection.SetReadLimit(s.config.MaxPayloadBytes)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer connection.Close(websocket.StatusNormalClosure, "event stream closed")

	go func() {
		for {
			if _, _, err := connection.Read(ctx); err != nil {
				cancel()
				return
			}
		}
	}()

	requestID, err := randomToken("req_")
	if err != nil {
		return
	}
	followID, err := randomToken("follow_")
	if err != nil {
		return
	}
	params := protocol.SessionFollowParams{SessionID: sessionID, FollowID: followID, Stream: true, Compact: mobile}
	if cursor != "" {
		params.Cursor = cursor
	}
	result, followError := s.router.Execute(ctx, protocol.MethodSessionFollow, deviceID, requestID, params, timeout)
	if followError != nil {
		if ctx.Err() == nil {
			s.writeEventFrame(ctx, connection, protocol.ErrorEnvelope{V: protocol.Version, Type: protocol.TypeError, RequestID: requestID, Error: *followError})
		}
		return
	}
	defer s.unfollowSession(deviceID, sessionID, followID)
	if err := s.writeEventFrame(ctx, connection, protocol.FollowResult{V: protocol.Version, Type: protocol.TypeFollowResult, RequestID: requestID, Result: result}); err != nil {
		return
	}

	ticker := time.NewTicker(s.config.HeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case event := <-sub.ch:
			if mobile && !mobileStreamEvent(event) {
				continue
			}
			if err := s.writeEventFrame(ctx, connection, event); err != nil {
				return
			}
		case <-sub.done:
			s.writeEventFrame(ctx, connection, protocol.ErrorEnvelope{V: protocol.Version, Type: protocol.TypeError, RequestID: requestID, Error: sub.reason})
			return
		case <-ticker.C:
			pingContext, pingCancel := context.WithTimeout(ctx, s.config.WriteTimeout)
			err := connection.Ping(pingContext)
			pingCancel()
			if err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

// mobileStreamEvent keeps large raw tool payloads off the phone socket.
func mobileStreamEvent(event protocol.Event) bool {
	switch event.Kind {
	case "assistant.stream", "session.snapshot", "connector.error", "session.resync_required":
		return true
	case "session.event":
		var payload struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(event.Data, &payload); err != nil {
			return false
		}
		switch payload.Type {
		case "user/message", "assistant/message", "turn/start", "turn/end":
			return true
		}
	}
	return false
}

func (s *Server) unfollowSession(deviceID, sessionID, followID string) {
	requestID, err := randomToken("req_")
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.config.CommandTimeout)
	defer cancel()
	_, _ = s.router.Execute(ctx, protocol.MethodSessionUnfollow, deviceID, requestID, protocol.SessionUnfollowParams{
		SessionID: sessionID,
		FollowID:  followID,
	}, s.config.CommandTimeout)
}

func (s *Server) writeEventFrame(ctx context.Context, connection *websocket.Conn, value any) error {
	writeContext, cancel := context.WithTimeout(ctx, s.config.WriteTimeout)
	defer cancel()
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return connection.Write(writeContext, websocket.MessageText, data)
}
