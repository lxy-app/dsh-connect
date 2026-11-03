package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

type commandResponse struct {
	result json.RawMessage
	err    *protocol.Error
}

type connectorConn struct {
	server        *Server
	ws            *websocket.Conn
	deviceID      string
	pendingDevice string
	authenticated bool

	writeMu   sync.Mutex
	mu        sync.Mutex
	pending   map[string]chan commandResponse
	done      chan struct{}
	closeOnce sync.Once
}

func (s *Server) handleConnector(w http.ResponseWriter, r *http.Request) {
	var deviceID string
	authenticated := false
	if header := r.Header.Get("Authorization"); header != "" {
		token, ok := bearerToken(header)
		if !ok {
			writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "valid device bearer token required", false))
			return
		}
		record, err := s.store.AuthenticateDevice(r.Context(), store.HashToken(token), nowUTC())
		if err != nil {
			writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "device token is invalid or device is not authorized", false))
			return
		}
		deviceID = record.Device.DeviceID
		authenticated = true
	}
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Origin checks do not authenticate non-browser Connectors. All Admin/App
		// channels still require a bearer token before this point.
		InsecureSkipVerify: true,
	})
	if err != nil {
		if authenticated {
			_ = s.store.MarkDeviceOffline(context.Background(), deviceID, nowUTC())
		}
		return
	}
	connection.SetReadLimit(s.config.MaxPayloadBytes)
	c := &connectorConn{
		server:        s,
		ws:            connection,
		deviceID:      deviceID,
		authenticated: authenticated,
		pending:       make(map[string]chan commandResponse),
		done:          make(chan struct{}),
	}
	if authenticated && !s.hub.Register(c) {
		log.Printf("connector connection rejected deviceId=%s reason=server_shutting_down", deviceID)
		_ = connection.Close(websocket.StatusGoingAway, "server shutting down")
		return
	}
	authMode := "pairing"
	if authenticated {
		authMode = "device_token"
	}
	log.Printf("connector connected authMode=%s deviceId=%s", authMode, deviceID)
	go c.heartbeat()
	c.readLoop()
}

func (c *connectorConn) readLoop() {
	defer c.close()
	for {
		messageType, data, err := c.ws.Read(context.Background())
		if err != nil {
			return
		}
		if messageType != websocket.MessageText {
			c.sendError("", protocol.NewError(protocol.CodeInvalidRequest, "only JSON text frames are supported", false))
			return
		}
		var header protocol.Header
		if err := json.Unmarshal(data, &header); err != nil || header.V != protocol.Version || header.Type == "" {
			c.sendError(header.RequestID, protocol.NewError(protocol.CodeInvalidRequest, "invalid versioned JSON envelope", false))
			return
		}
		if !c.authenticated {
			switch header.Type {
			case protocol.TypePairStart:
				if c.pendingDevice != "" {
					c.sendError(header.RequestID, protocol.NewError(protocol.CodePairingChallengeInvalid, "pair.start has already been processed", false))
					return
				}
				if !c.handlePairStart(data) {
					return
				}
			case protocol.TypePairAuthorize:
				if c.pendingDevice == "" {
					c.sendError(header.RequestID, protocol.NewError(protocol.CodeUnauthorized, "pair.start must precede pair.authorize", false))
					return
				}
				if !c.handlePairAuthorize(data) {
					return
				}
			case protocol.TypeRequest:
				// The transport is open during pairing, but control methods require
				// pair.complete. Reject an early request without discarding a valid
				// pending challenge; older panels may poll this capability.
				c.sendError(header.RequestID, protocol.NewError(protocol.CodeUnauthorized, "desktop authorization is required before control requests", false))
			default:
				c.sendError(header.RequestID, protocol.NewError(protocol.CodeUnauthorized, "desktop authorization is required before commands or events", false))
				return
			}
			continue
		}

		switch header.Type {
		case protocol.TypeResult:
			var result protocol.Result
			if err := json.Unmarshal(data, &result); err != nil || result.RequestID == "" || len(result.Result) == 0 || !json.Valid(result.Result) {
				c.sendError(header.RequestID, protocol.NewError(protocol.CodeInvalidRequest, "invalid result envelope", false))
				continue
			}
			c.resolve(result.RequestID, commandResponse{result: result.Result})
		case protocol.TypeError:
			var envelope protocol.ErrorEnvelope
			if err := json.Unmarshal(data, &envelope); err != nil || envelope.RequestID == "" || envelope.Error.Code == "" || envelope.Error.Message == "" {
				c.sendError(header.RequestID, protocol.NewError(protocol.CodeInvalidRequest, "invalid error envelope", false))
				continue
			}
			c.resolve(envelope.RequestID, commandResponse{err: &envelope.Error})
		case protocol.TypeRequest:
			var request protocol.ConnectorRequest
			if err := json.Unmarshal(data, &request); err != nil || !validID(request.RequestID) || !validText(request.Method, 128) {
				c.sendError(header.RequestID, protocol.NewError(protocol.CodeInvalidRequest, "invalid Connector request envelope", false))
				continue
			}
			requestContext, cancel := context.WithTimeout(context.Background(), c.server.config.CommandTimeout)
			result, commandError := c.server.handleConnectorRequest(requestContext, c, request)
			cancel()
			if commandError != nil {
				c.sendError(request.RequestID, *commandError)
				continue
			}
			payload, err := json.Marshal(result)
			if err != nil || !json.Valid(payload) {
				c.sendError(request.RequestID, protocol.NewError(protocol.CodeInternalError, "could not encode Connector request result", false))
				continue
			}
			if err := c.writeJSON(context.Background(), protocol.Result{
				V: protocol.Version, Type: protocol.TypeResult, RequestID: request.RequestID, Result: payload,
			}); err != nil {
				return
			}
		case protocol.TypeEvent:
			var event protocol.Event
			if err := json.Unmarshal(data, &event); err != nil || !validID(event.EventID) || event.DeviceID != c.deviceID || !validID(event.SessionID) || !validText(event.Kind, 256) || event.OccurredAt.IsZero() || len(event.Data) == 0 || !json.Valid(event.Data) {
				c.sendError(header.RequestID, protocol.NewError(protocol.CodeInvalidRequest, "invalid event envelope", false))
				continue
			}
			if event.Kind == protocol.KindInteractionRequest || event.Kind == protocol.KindInteractionResolved {
				c.server.ingestInteractionEvent(event)
				continue
			}
			c.server.events.Broadcast(event)
		default:
			c.sendError(header.RequestID, protocol.NewError(protocol.CodeInvalidRequest, "unexpected authenticated Connector frame", false))
		}
	}
}

func (c *connectorConn) handlePairStart(data []byte) bool {
	var request protocol.PairStart
	if err := json.Unmarshal(data, &request); err != nil || !validID(request.RequestID) || !validText(request.PairingCode, 128) || !validText(request.DeviceName, 256) || !validText(request.ConnectorVersion, 128) {
		c.sendError(request.RequestID, protocol.NewError(protocol.CodeInvalidRequest, "invalid pair.start fields", false))
		return false
	}
	log.Printf("connector pair.start received requestId=%q connectorVersion=%q", request.RequestID, request.ConnectorVersion)
	now := nowUTC()
	deviceID, err := randomToken("dev_")
	if err != nil {
		c.sendError(request.RequestID, protocol.NewError(protocol.CodeInternalError, "could not generate device identity", true))
		return false
	}
	pairingToken, err := randomToken("dpt_")
	if err != nil {
		c.sendError(request.RequestID, protocol.NewError(protocol.CodeInternalError, "could not generate pairing challenge", true))
		return false
	}
	expiresAt := now.Add(c.server.config.PairingChallengeTTL)
	print := fingerprint(deviceID, pairingToken)
	record := store.DeviceRecord{
		Device: protocol.Device{
			DeviceID:         deviceID,
			DeviceName:       request.DeviceName,
			Fingerprint:      print,
			ConnectorVersion: request.ConnectorVersion,
			Status:           "waiting_desktop_authorization",
			Workspaces:       make([]protocol.Workspace, 0),
			Scopes:           make([]string, 0),
			CreatedAt:        now,
			UpdatedAt:        now,
		},
		PairingTokenHash: store.HashToken(pairingToken),
		PairingExpiresAt: &expiresAt,
	}
	pairingContext, cancelPairing := context.WithTimeout(context.Background(), c.server.config.CommandTimeout)
	err = c.server.store.BeginPairing(pairingContext, store.HashToken(request.PairingCode), record)
	cancelPairing()
	if err != nil {
		commandError := pairingStoreError(err)
		log.Printf("connector pair.start failed requestId=%q deviceId=%s errorCode=%s: %v", request.RequestID, deviceID, commandError.Code, err)
		c.sendError(request.RequestID, commandError)
		c.server.audit(store.AuditEntry{OccurredAt: now, Actor: "connector", Action: "pair.start", RequestID: request.RequestID, DeviceID: deviceID, Result: "error", ErrorCode: commandError.Code})
		return false
	}
	c.pendingDevice = deviceID
	challenge := protocol.PairChallenge{
		V: protocol.Version, Type: protocol.TypePairChallenge, RequestID: request.RequestID,
		DeviceID: deviceID, Fingerprint: print, PairingToken: pairingToken, ExpiresAt: expiresAt,
	}
	if err := c.writeJSON(context.Background(), challenge); err != nil {
		log.Printf("connector pair.start challenge write failed requestId=%q deviceId=%s: %v", request.RequestID, deviceID, err)
		return false
	}
	log.Printf("connector pair.start waiting_desktop_authorization requestId=%q deviceId=%s expiresAt=%s", request.RequestID, deviceID, expiresAt.Format(time.RFC3339))
	c.server.audit(store.AuditEntry{OccurredAt: now, Actor: "connector", Action: "pair.start", RequestID: request.RequestID, DeviceID: deviceID, Result: "waiting_desktop_authorization"})
	return true
}

func (c *connectorConn) handlePairAuthorize(data []byte) bool {
	var request protocol.PairAuthorize
	if err := json.Unmarshal(data, &request); err != nil || !validID(request.RequestID) || request.PairingToken == "" || !validGrants(request.Workspaces, request.Scopes) {
		c.sendError(request.RequestID, protocol.NewError(protocol.CodeInvalidRequest, "invalid pair.authorize fields or grants", false))
		return false
	}
	log.Printf("connector pair.authorize received requestId=%q deviceId=%s workspaceCount=%d scopeCount=%d", request.RequestID, c.pendingDevice, len(request.Workspaces), len(request.Scopes))
	deviceToken, err := randomToken("dct_")
	if err != nil {
		c.sendError(request.RequestID, protocol.NewError(protocol.CodeInternalError, "could not generate device token", true))
		return false
	}
	now := nowUTC()
	authorizeContext, cancelAuthorize := context.WithTimeout(context.Background(), c.server.config.CommandTimeout)
	record, err := c.server.store.AuthorizePairing(authorizeContext, c.pendingDevice, store.HashToken(request.PairingToken), store.HashToken(deviceToken), request.Workspaces, request.Scopes, now)
	cancelAuthorize()
	if err != nil {
		commandError := pairingStoreError(err)
		log.Printf("connector pair.authorize store failed requestId=%q deviceId=%s errorCode=%s: %v", request.RequestID, c.pendingDevice, commandError.Code, err)
		c.sendError(request.RequestID, commandError)
		c.server.audit(store.AuditEntry{OccurredAt: now, Actor: "connector", Action: "pair.authorize", RequestID: request.RequestID, DeviceID: c.pendingDevice, Result: "error", ErrorCode: commandError.Code})
		return false
	}
	c.deviceID = c.pendingDevice
	c.pendingDevice = ""
	c.authenticated = true
	if !c.server.hub.Register(c) {
		commandError := protocol.NewError(protocol.CodeInternalError, "Server is shutting down; start pairing again with a new code", true)
		log.Printf("connector pair.authorize hub registration failed requestId=%q deviceId=%s", request.RequestID, c.deviceID)
		c.sendError(request.RequestID, commandError)
		c.server.audit(store.AuditEntry{OccurredAt: now, Actor: "connector", Action: "pair.authorize", RequestID: request.RequestID, DeviceID: c.deviceID, Result: "error", ErrorCode: commandError.Code})
		return false
	}
	complete := protocol.PairComplete{
		V: protocol.Version, Type: protocol.TypePairComplete, RequestID: request.RequestID,
		DeviceID: record.Device.DeviceID, DeviceToken: deviceToken, Fingerprint: record.Device.Fingerprint,
	}
	if err := c.writeJSON(context.Background(), complete); err != nil {
		log.Printf("connector pair.authorize complete write failed requestId=%q deviceId=%s: %v", request.RequestID, c.deviceID, err)
		return false
	}
	log.Printf("connector pair.authorize completed requestId=%q deviceId=%s", request.RequestID, c.deviceID)
	c.server.audit(store.AuditEntry{OccurredAt: now, Actor: "connector", Action: "pair.authorize", RequestID: request.RequestID, DeviceID: c.deviceID, Result: "success"})
	return true
}

func pairingStoreError(err error) protocol.Error {
	switch {
	case errors.Is(err, store.ErrPairingCodeUsed):
		return protocol.NewError(protocol.CodePairingCodeUsed, "pairing code has already been used", false)
	case errors.Is(err, store.ErrPairingCodeExpired):
		return protocol.NewError(protocol.CodePairingCodeExpired, "pairing code has expired", false)
	case errors.Is(err, store.ErrPairingChallengeExpired):
		return protocol.NewError(protocol.CodePairingChallengeExpired, "pairing challenge has expired", true)
	case errors.Is(err, store.ErrPairingAlreadyCompleted):
		return protocol.NewError(protocol.CodePairingAlreadyCompleted, "pairing has already been completed", false)
	case errors.Is(err, store.ErrPairingChallengeInvalid), errors.Is(err, store.ErrDeviceNotFound):
		return protocol.NewError(protocol.CodePairingChallengeInvalid, "pairing token does not match this connection", false)
	case errors.Is(err, store.ErrPairingCodeInvalid):
		return protocol.NewError(protocol.CodePairingCodeInvalid, "pairing code is invalid", false)
	default:
		return protocol.NewError(protocol.CodeInternalError, "Server could not complete pairing", true)
	}
}

func validGrants(workspaces []protocol.Workspace, scopes []string) bool {
	if len(workspaces) == 0 || len(scopes) == 0 {
		return false
	}
	workspaceIDs := make(map[string]struct{}, len(workspaces))
	for _, workspace := range workspaces {
		if !validID(workspace.ID) || !validText(workspace.Name, 256) || !validText(workspace.Path, 4096) {
			return false
		}
		if _, exists := workspaceIDs[workspace.ID]; exists {
			return false
		}
		workspaceIDs[workspace.ID] = struct{}{}
	}
	seenScopes := make(map[string]struct{}, len(scopes))
	for _, scope := range scopes {
		if scope != "read" && scope != "prompt" && scope != "approve" && scope != "cancel" {
			return false
		}
		if _, exists := seenScopes[scope]; exists {
			return false
		}
		seenScopes[scope] = struct{}{}
	}
	return true
}

func (c *connectorConn) execute(ctx context.Context, command protocol.Command) (json.RawMessage, *protocol.Error) {
	response := make(chan commandResponse, 1)
	c.mu.Lock()
	select {
	case <-c.done:
		c.mu.Unlock()
		return nil, errorPtr(protocol.NewError(protocol.CodeDeviceOffline, "desktop Connector is offline", true))
	default:
	}
	if _, exists := c.pending[command.RequestID]; exists {
		c.mu.Unlock()
		return nil, errorPtr(protocol.NewError(protocol.CodeRequestInFlight, "requestId is already in flight on this Connector", false))
	}
	c.pending[command.RequestID] = response
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.pending, command.RequestID)
		c.mu.Unlock()
	}()
	if err := c.writeJSON(ctx, command); err != nil {
		return nil, errorPtr(protocol.NewError(protocol.CodeDeviceOffline, "could not write command to Connector", true))
	}
	select {
	case answer := <-response:
		return answer.result, answer.err
	case <-ctx.Done():
		return nil, errorPtr(protocol.NewError(protocol.CodeCommandTimeout, "Connector command timed out", true))
	case <-c.done:
		return nil, errorPtr(protocol.NewError(protocol.CodeDeviceOffline, "desktop Connector disconnected", true))
	}
}

func (c *connectorConn) resolve(requestID string, response commandResponse) {
	c.mu.Lock()
	pending := c.pending[requestID]
	c.mu.Unlock()
	if pending != nil {
		select {
		case pending <- response:
		default:
		}
	}
}

func (c *connectorConn) writeJSON(ctx context.Context, value any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.server.config.WriteTimeout)
		defer cancel()
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.ws.Write(ctx, websocket.MessageText, data)
}

func (c *connectorConn) sendError(requestID string, commandError protocol.Error) {
	log.Printf("connector error requestId=%q deviceId=%s pendingDeviceId=%s errorCode=%s", requestID, c.deviceID, c.pendingDevice, commandError.Code)
	if err := c.writeJSON(context.Background(), protocol.ErrorEnvelope{
		V: protocol.Version, Type: protocol.TypeError, RequestID: requestID, Error: commandError,
	}); err != nil {
		log.Printf("connector error write failed requestId=%q deviceId=%s errorCode=%s: %v", requestID, c.deviceID, commandError.Code, err)
	}
}

func (c *connectorConn) heartbeat() {
	ticker := time.NewTicker(c.server.config.HeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), c.server.config.WriteTimeout)
			err := c.ws.Ping(ctx)
			cancel()
			if err != nil {
				_ = c.ws.Close(websocket.StatusGoingAway, "heartbeat failed")
				return
			}
		case <-c.done:
			return
		}
	}
}

// shutdown closes the connection on administrative request (revoke/delete) and
// reports the reason to the Connector.
func (c *connectorConn) shutdown(reason string) {
	_ = c.ws.Close(websocket.StatusPolicyViolation, reason)
}

func (c *connectorConn) close() {
	c.closeOnce.Do(func() {
		close(c.done)
		c.mu.Lock()
		for requestID, pending := range c.pending {
			select {
			case pending <- commandResponse{err: errorPtr(protocol.NewError(protocol.CodeDeviceOffline, "desktop Connector disconnected", true))}:
			default:
			}
			delete(c.pending, requestID)
		}
		c.mu.Unlock()
		if c.authenticated && c.server.hub.Unregister(c) {
			// Only the connection that is still authoritative may clear prompts;
			// a replaced Connector must not wipe requests its successor already sent.
			c.server.expireDeviceInteractions(c.deviceID)
			// MarkDeviceOffline deliberately skips revoked devices so an
			// administrative revocation is not overwritten by the disconnect.
			_ = c.server.store.MarkDeviceOffline(context.Background(), c.deviceID, nowUTC())
		}
		_ = c.ws.Close(websocket.StatusNormalClosure, "connection closed")
	})
}
