package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/connector/ws", s.handleConnector)
	mux.HandleFunc("POST /v1/pairing/desktop-codes", s.requireAdmin(s.handleCreatePairingCode))
	mux.HandleFunc("GET /v1/devices", s.requireAdmin(s.handleDevices))
	mux.HandleFunc("GET /v1/sessions", s.requireAdmin(s.handleSessionList))
	mux.HandleFunc("POST /v1/sessions", s.requireAdmin(s.handleSessionCreate))
	mux.HandleFunc("GET /v1/sessions/{sessionId}/page", s.requireAdmin(s.handleSessionPage))
	mux.HandleFunc("POST /v1/sessions/{sessionId}/prompt", s.requireAdmin(s.handleSessionPrompt))
	mux.HandleFunc("POST /v1/sessions/{sessionId}/cancel", s.requireAdmin(s.handleSessionCancel))
	mux.HandleFunc("GET /v1/events/ws", s.requireAdmin(s.handleEvents))
	s.mobileRoutes(mux)
	s.attachmentRoutes(mux)
	s.adminRoutes(mux)
	return s.corsMiddleware(mux)
}

func (s *Server) handleCreatePairingCode(w http.ResponseWriter, r *http.Request) {
	_, response, commandError := s.issuePairingCode(r)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	s.audit(store.AuditEntry{OccurredAt: nowUTC(), Actor: "bootstrap", Action: "pairing_code.create", Result: "success", SourceIP: sourceIP(r)})
	writeJSON(w, http.StatusCreated, protocol.DesktopCodeResponse{
		Code:      response.Code,
		ExpiresAt: response.ExpiresAt,
		ServerURL: response.ServerURL,
	})
}

func (s *Server) handleDevices(w http.ResponseWriter, r *http.Request) {
	records, err := s.store.Devices(r.Context())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load devices", true))
		return
	}
	devices := make([]protocol.Device, 0, len(records))
	for _, record := range records {
		devices = append(devices, record.Device)
	}
	writeJSON(w, http.StatusOK, protocol.DeviceListResponse{Devices: devices})
}

func (s *Server) handleSessionList(w http.ResponseWriter, r *http.Request) {
	deviceID := r.URL.Query().Get("deviceId")
	workspaceID := r.URL.Query().Get("workspaceId")
	if !validID(deviceID) || (workspaceID != "" && !validID(workspaceID)) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid deviceId and workspaceId required", false))
		return
	}
	timeout, commandError := s.queryTimeout(r)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	params := map[string]string{}
	if workspaceID != "" {
		params["workspaceId"] = workspaceID
	}
	requestID, err := randomToken("req_")
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate requestId", true))
		return
	}
	s.executeREST(w, r, protocol.MethodSessionList, deviceID, requestID, "", params, timeout)
}

func (s *Server) handleSessionCreate(w http.ResponseWriter, r *http.Request) {
	var request protocol.SessionCreateRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if !validID(request.RequestID) || !validID(request.DeviceID) || !validID(request.WorkspaceID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "requestId, deviceId, and workspaceId are required", false))
		return
	}
	params := map[string]string{"workspaceId": request.WorkspaceID}
	s.executeREST(w, r, protocol.MethodSessionCreate, request.DeviceID, request.RequestID, "", params, time.Duration(request.TimeoutMS)*time.Millisecond)
}

func (s *Server) handleSessionPage(w http.ResponseWriter, r *http.Request) {
	deviceID := r.URL.Query().Get("deviceId")
	sessionID := r.PathValue("sessionId")
	cursor := r.URL.Query().Get("cursor")
	if !validID(deviceID) || !validID(sessionID) || len(cursor) > 4096 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid deviceId, sessionId, and cursor required", false))
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "limit must be between 1 and 200", false))
			return
		}
		limit = parsed
	}
	timeout, commandError := s.queryTimeout(r)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	params := map[string]any{"sessionId": sessionID, "limit": limit}
	if cursor != "" {
		params["cursor"] = cursor
	}
	requestID, err := randomToken("req_")
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate requestId", true))
		return
	}
	s.executeREST(w, r, protocol.MethodSessionPage, deviceID, requestID, sessionID, params, timeout)
}

func (s *Server) handleSessionPrompt(w http.ResponseWriter, r *http.Request) {
	var request protocol.SessionPromptRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	sessionID := r.PathValue("sessionId")
	if !validID(request.RequestID) || !validID(request.DeviceID) || !validID(sessionID) || (request.Mode != "queue" && request.Mode != "steer") || len(request.Content) == 0 || len(request.ClientTimeZone) > 128 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "requestId, deviceId, sessionId, mode, and content are required", false))
		return
	}
	for _, part := range request.Content {
		if part.Type != "text" || part.Text == "" {
			writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "only non-empty text content parts are supported", false))
			return
		}
	}
	params := map[string]any{
		"sessionId": sessionID,
		"mode":      request.Mode,
		"content":   request.Content,
	}
	if request.ClientTimeZone != "" {
		params["clientTimeZone"] = request.ClientTimeZone
	}
	s.executeREST(w, r, protocol.MethodSessionPrompt, request.DeviceID, request.RequestID, sessionID, params, time.Duration(request.TimeoutMS)*time.Millisecond)
}

func (s *Server) handleSessionCancel(w http.ResponseWriter, r *http.Request) {
	var request protocol.SessionCancelRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	sessionID := r.PathValue("sessionId")
	if !validID(request.RequestID) || !validID(request.DeviceID) || !validID(sessionID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "requestId, deviceId, and sessionId are required", false))
		return
	}
	params := map[string]string{"sessionId": sessionID}
	s.executeREST(w, r, protocol.MethodSessionCancel, request.DeviceID, request.RequestID, sessionID, params, time.Duration(request.TimeoutMS)*time.Millisecond)
}

func (s *Server) executeREST(w http.ResponseWriter, r *http.Request, method, deviceID, requestID, sessionID string, params any, timeout time.Duration) {
	result, commandError := s.router.Execute(r.Context(), method, deviceID, requestID, params, timeout)
	auditResult := "success"
	errorCode := ""
	if commandError != nil {
		auditResult = "error"
		errorCode = commandError.Code
	}
	s.audit(store.AuditEntry{
		OccurredAt: nowUTC(),
		Actor:      "bootstrap",
		Action:     method,
		RequestID:  requestID,
		DeviceID:   deviceID,
		SessionID:  sessionID,
		Result:     auditResult,
		ErrorCode:  errorCode,
		SourceIP:   sourceIP(r),
	})
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	writeRawJSON(w, http.StatusOK, result)
}

func (s *Server) queryTimeout(r *http.Request) (time.Duration, *protocol.Error) {
	raw := r.URL.Query().Get("timeoutMs")
	if raw == "" {
		return s.config.CommandTimeout, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 || time.Duration(value)*time.Millisecond > maxCommandTimeout {
		return 0, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "timeoutMs must be between 1 and 120000", false))
	}
	return time.Duration(value) * time.Millisecond, nil
}

func writeRawJSON(w http.ResponseWriter, status int, raw json.RawMessage) {
	if len(raw) == 0 || !json.Valid(raw) {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "Connector returned an invalid JSON result", false))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
	_, _ = w.Write([]byte{'\n'})
}
