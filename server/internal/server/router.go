package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

type flight struct {
	method      string
	deviceID    string
	requestHash string
	done        chan struct{}
	result      json.RawMessage
	err         *protocol.Error
}

type Router struct {
	server  *Server
	mu      sync.Mutex
	flights map[string]*flight
}

func NewRouter(server *Server) *Router {
	return &Router{server: server, flights: make(map[string]*flight)}
}

func (r *Router) Execute(ctx context.Context, method, deviceID, requestID string, params any, timeout time.Duration) (json.RawMessage, *protocol.Error) {
	raw, err := json.Marshal(params)
	if err != nil {
		return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "command params are not JSON serializable", false))
	}
	if string(raw) == "null" {
		raw = json.RawMessage(`{}`)
	}
	if timeout == 0 {
		timeout = r.server.config.CommandTimeout
	}
	if timeout <= 0 || timeout > maxCommandTimeout {
		return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "timeoutMs must be between 1 and 120000", false))
	}
	requestHash := hashRequest(method, deviceID, raw)
	if !isDurableIdempotentMethod(method) {
		return r.executeDirect(ctx, method, deviceID, requestID, raw, timeout)
	}

	r.mu.Lock()
	record, found, lookupError := r.server.store.Idempotency(ctx, requestID)
	if lookupError != nil {
		r.mu.Unlock()
		return nil, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not read command idempotency state", true))
	}
	if found {
		r.mu.Unlock()
		if record.Method != method || record.DeviceID != deviceID || record.RequestHash != requestHash {
			return nil, errorPtr(protocol.NewError(protocol.CodeIdempotencyConflict, "requestId was already used with different command input", false))
		}
		return record.Result, record.Error
	}
	if existing, ok := r.flights[requestID]; ok {
		r.mu.Unlock()
		if existing.method != method || existing.deviceID != deviceID || existing.requestHash != requestHash {
			return nil, errorPtr(protocol.NewError(protocol.CodeIdempotencyConflict, "requestId is in flight with different command input", false))
		}
		return waitForFlight(ctx, existing)
	}
	current := &flight{method: method, deviceID: deviceID, requestHash: requestHash, done: make(chan struct{})}
	r.flights[requestID] = current
	r.mu.Unlock()

	go r.runIdempotent(current, method, deviceID, requestID, raw, requestHash, timeout)
	return waitForFlight(ctx, current)
}

func waitForFlight(ctx context.Context, current *flight) (json.RawMessage, *protocol.Error) {
	select {
	case <-current.done:
		return current.result, current.err
	case <-ctx.Done():
		return nil, errorPtr(protocol.NewError(protocol.CodeCommandTimeout, "request context ended while waiting for the shared command result", true))
	}
}

func (r *Router) runIdempotent(current *flight, method, deviceID, requestID string, raw json.RawMessage, requestHash string, timeout time.Duration) {
	result, commandError := r.executeDirect(context.Background(), method, deviceID, requestID, raw, timeout)
	now := nowUTC()
	record := store.IdempotencyRecord{
		RequestID:   requestID,
		Method:      method,
		DeviceID:    deviceID,
		RequestHash: requestHash,
		Result:      result,
		Error:       commandError,
		CreatedAt:   now,
		CompletedAt: now,
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if !isUnsubmittedDeviceOffline(commandError) {
		if err := r.server.store.CompleteIdempotency(context.Background(), record); err != nil {
			result = nil
			commandError = errorPtr(protocol.NewError(protocol.CodeInternalError, "could not persist command idempotency outcome", true))
		}
	}
	current.result = result
	current.err = commandError
	delete(r.flights, requestID)
	close(current.done)
}

func hashRequest(method, deviceID string, params json.RawMessage) string {
	sum := sha256.Sum256(append(append(append([]byte(method), 0), []byte(deviceID)...), append([]byte{0}, params...)...))
	return hex.EncodeToString(sum[:])
}

func isUnsubmittedDeviceOffline(commandError *protocol.Error) bool {
	if commandError == nil || commandError.Code != protocol.CodeDeviceOffline || len(commandError.Details) == 0 {
		return false
	}
	var details struct {
		Submitted *bool `json:"submitted"`
	}
	if err := json.Unmarshal(commandError.Details, &details); err != nil {
		return false
	}
	return details.Submitted != nil && !*details.Submitted
}

func (r *Router) executeDirect(ctx context.Context, method, deviceID, requestID string, params json.RawMessage, timeout time.Duration) (json.RawMessage, *protocol.Error) {
	scope, ok := requiredScope(method)
	if !ok {
		return nil, errorPtr(protocol.NewError(protocol.CodeMethodNotSupported, "unsupported command method", false))
	}
	device, err := r.server.store.Device(ctx, deviceID)
	if errors.Is(err, store.ErrDeviceNotFound) {
		return nil, errorPtr(protocol.NewError(protocol.CodeNotFound, "device not found", false))
	}
	if err != nil {
		return nil, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not load device", true))
	}
	if !contains(device.Device.Scopes, scope) {
		return nil, errorPtr(protocol.NewError(protocol.CodeForbidden, "device grant lacks scope "+scope, false))
	}
	if workspaceID := workspaceFromParams(params); workspaceID != "" && !hasWorkspace(device.Device.Workspaces, workspaceID) {
		return nil, errorPtr(protocol.NewError(protocol.CodeForbidden, "workspace is not authorized", false))
	}
	connection := r.server.hub.Get(deviceID)
	if connection == nil {
		commandError := protocol.NewError(protocol.CodeDeviceOffline, "desktop Connector is offline", true)
		commandError.Details = json.RawMessage(`{"submitted":false}`)
		return nil, errorPtr(commandError)
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	response, commandError := connection.execute(ctx, protocol.Command{
		V:         protocol.Version,
		Type:      protocol.TypeCommand,
		RequestID: requestID,
		Method:    method,
		Params:    params,
		TimeoutMS: int((timeout + time.Millisecond - 1) / time.Millisecond),
	})
	return response, commandError
}

func isDurableIdempotentMethod(method string) bool {
	switch method {
	case protocol.MethodSessionCreate, protocol.MethodSessionPrompt, protocol.MethodSessionModelSelect:
		return true
	default:
		return false
	}
}

func requiredScope(method string) (string, bool) {
	switch method {
	case protocol.MethodSessionList, protocol.MethodSessionPage, protocol.MethodSessionTranscript, protocol.MethodSessionFollow, protocol.MethodSessionUnfollow, protocol.MethodSessionAttachmentFetch, protocol.MethodSessionModelCatalog:
		return "read", true
	case protocol.MethodSessionCreate, protocol.MethodSessionPrompt, protocol.MethodSessionModelSelect:
		return "prompt", true
	case protocol.MethodSessionCancel:
		return "cancel", true
	case protocol.MethodInteractionRespond:
		return "approve", true
	default:
		return "", false
	}
}

func workspaceFromParams(params json.RawMessage) string {
	var value struct {
		WorkspaceID string `json:"workspaceId"`
	}
	_ = json.Unmarshal(params, &value)
	return value.WorkspaceID
}

func hasWorkspace(workspaces []protocol.Workspace, id string) bool {
	for _, workspace := range workspaces {
		if workspace.ID == id {
			return true
		}
	}
	return false
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
