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
	s.serveEvents(w, r, deviceID, "", sessionID, cursor, nil)
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
	actor, commandError := s.authorizeMobileSession(r, deviceID, workspaceID, sessionID, "read")
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	s.serveEvents(w, r, deviceID, workspaceID, sessionID, cursor, &actor)
}

func (s *Server) serveEvents(w http.ResponseWriter, r *http.Request, deviceID, workspaceID, sessionID, cursor string, mobile *mobileActor) {
	timeout, commandError := s.queryTimeout(r)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	var sub *subscription
	var ok bool
	if mobile != nil {
		sub, ok = s.events.SubscribeMobile(deviceID, sessionID, mobile.Device.Device.MobileDeviceID, mobile.User.ID)
	} else {
		sub, ok = s.events.Subscribe(deviceID, sessionID)
	}
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeDeviceOffline, "server is shutting down", true))
		return
	}
	defer s.events.Unsubscribe(sub)
	if mobile != nil {
		// Register first, then reload the current phone/user and authorize again.
		// A revocation racing the initial handshake either makes this check fail
		// or closes the registered stream. The stale handshake actor is not enough.
		if commandError := s.reauthorizeMobileEvent(r, deviceID, workspaceID, sessionID, *mobile); commandError != nil {
			writeAPIError(w, *commandError)
			return
		}
	}

	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	connection.SetReadLimit(s.config.MaxPayloadBytes)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer connection.Close(websocket.StatusNormalClosure, "event stream closed")

	// Only security revocation cancels an in-progress mobile session.follow.
	// Desktop streams and ordinary supersession keep their existing terminal
	// error and cleanup behavior.
	if mobile != nil {
		go func() {
			select {
			case <-sub.done:
				if sub.reason.Code == protocol.CodeUnauthorized {
					cancel()
				}
			case <-ctx.Done():
			}
		}()
	}
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
	params := protocol.SessionFollowParams{SessionID: sessionID, FollowID: followID, Stream: true, Compact: mobile != nil}
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
			// A revoked subscription may still have buffered events. Never forward
			// one after EventHub has closed the subscription.
			select {
			case <-sub.done:
				return
			default:
			}
			if mobile != nil && !mobileStreamEvent(event) {
				continue
			}
			if err := s.writeEventFrame(ctx, connection, event); err != nil {
				return
			}
		case <-sub.done:
			s.writeEventFrame(context.Background(), connection, protocol.ErrorEnvelope{V: protocol.Version, Type: protocol.TypeError, RequestID: requestID, Error: sub.reason})
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

func (s *Server) reauthorizeMobileEvent(r *http.Request, deviceID, workspaceID, sessionID string, actor mobileActor) *protocol.Error {
	device, deviceErr := s.store.MobileDeviceByID(r.Context(), actor.Device.Device.MobileDeviceID)
	user, userErr := s.store.UserByID(r.Context(), actor.User.ID)
	if deviceErr != nil || userErr != nil ||
		device.Device.Status != "active" || device.Device.UserID != actor.User.ID || user.Status != "active" {
		return errorPtr(protocol.NewError(protocol.CodeUnauthorized, "mobile event access is no longer active", false))
	}
	actor.Device = device
	actor.User = user
	ctx := context.WithValue(r.Context(), mobileContextKey{}, actor)
	_, commandError := s.authorizeMobileSession(r.WithContext(ctx), deviceID, workspaceID, sessionID, "read")
	return commandError
}

// mobileStreamEvent keeps large raw tool payloads off the phone socket.
func mobileStreamEvent(event protocol.Event) bool {
	switch event.Kind {
	case "assistant.stream", "session.snapshot", "connector.error", "session.resync_required", protocol.EventKindAttachmentReady:
		return true
	case "session.event":
		var payload struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(event.Data, &payload); err != nil {
			return false
		}
		switch payload.Type {
		case "user/message", "assistant/message", "turn/start", "turn/end", "model/selection":
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
