package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

// ---------- mobile REST: access, workspaces and sessions ----------

func (s *Server) mobileAccessRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/mobile/access", s.mobileAuth(s.handleMobileAccessOverview))
	mux.HandleFunc("POST /v1/mobile/access/requests", s.mobileAuth(s.handleMobileAccessRequest))
	mux.HandleFunc("DELETE /v1/mobile/access/{grantId}", s.mobileAuth(s.handleMobileAccessRevoke))
	mux.HandleFunc("GET /v1/mobile/workspaces", s.mobileAuth(s.handleMobileWorkspaces))
	mux.HandleFunc("GET /v1/mobile/sessions", s.mobileAuth(s.handleMobileSessionList))
	mux.HandleFunc("POST /v1/mobile/sessions", s.mobileAuth(s.handleMobileSessionCreate))
	mux.HandleFunc("GET /v1/mobile/sessions/{sessionId}/messages", s.mobileAuth(s.handleMobileSessionMessages))
	mux.HandleFunc("GET /v1/mobile/sessions/{sessionId}/model", s.mobileAuth(s.handleMobileSessionModel))
	mux.HandleFunc("POST /v1/mobile/sessions/{sessionId}/model", s.mobileAuth(s.handleMobileSessionModelSelect))
	mux.HandleFunc("POST /v1/mobile/sessions/{sessionId}/prompt", s.mobileAuth(s.handleMobileSessionPrompt))
	mux.HandleFunc("POST /v1/mobile/sessions/{sessionId}/cancel", s.mobileAuth(s.handleMobileSessionCancel))
}

// handleMobileAccessOverview lists desktops and the phone's grant state. It
// intentionally omits workspace filesystem paths.
func (s *Server) handleMobileAccessOverview(w http.ResponseWriter, r *http.Request) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
		return
	}
	grants, err := s.store.MobileAccessGrantsForMobile(r.Context(), actor.Device.Device.MobileDeviceID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load mobile access grants", true))
		return
	}
	byDevice := make(map[string]store.MobileAccessGrantRecord, len(grants))
	for _, grant := range grants {
		byDevice[grant.DeviceID] = grant
	}
	devices, err := s.store.Devices(r.Context())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load desktop devices", true))
		return
	}
	access, err := s.policyAccessForUser(r.Context(), actor.User.ID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not resolve user access policy", true))
		return
	}
	desktops := make([]protocol.MobileDesktopAccess, 0, len(devices))
	for _, device := range devices {
		if device.Device.Status == "revoked" || device.Device.Status == "waiting_desktop_authorization" {
			continue
		}
		allowedWorkspaces := access.workspaceScopes(device.Device.DeviceID)
		if len(allowedWorkspaces) == 0 {
			continue
		}
		availableWorkspaces := make([]protocol.MobileWorkspaceSummary, 0, len(allowedWorkspaces))
		for _, workspace := range mobileWorkspaceSummaries(device.Device.Workspaces) {
			if _, allowed := allowedWorkspaces[workspace.ID]; allowed {
				availableWorkspaces = append(availableWorkspaces, workspace)
			}
		}
		desktop := protocol.MobileDesktopAccess{
			DeviceID:            device.Device.DeviceID,
			DeviceName:          device.Device.DeviceName,
			ConnectorVersion:    device.Device.ConnectorVersion,
			Online:              s.hub.Get(device.Device.DeviceID) != nil,
			AvailableWorkspaces: availableWorkspaces,
			AvailableScopes:     policyScopeUnion(allowedWorkspaces, device.Device.Scopes),
		}
		if grant, exists := byDevice[device.Device.DeviceID]; exists {
			effectiveGrant := grant
			effectiveGrant.Workspaces = nil
			for _, workspace := range grant.Workspaces {
				if _, allowed := allowedWorkspaces[workspace.ID]; allowed {
					effectiveGrant.Workspaces = append(effectiveGrant.Workspaces, workspace)
				}
			}
			effectiveGrant.Scopes = policyGrantScopes(grant, access)
			projection := mobileGrantProjection(effectiveGrant, actor, device.Device)
			desktop.Grant = &projection
		}
		desktops = append(desktops, desktop)
	}
	sort.Slice(desktops, func(i, j int) bool {
		if desktops[i].Online != desktops[j].Online {
			return desktops[i].Online
		}
		return desktops[i].DeviceName < desktops[j].DeviceName
	})
	writeJSON(w, http.StatusOK, protocol.MobileAccessOverviewResponse{Desktops: desktops})
}

// handleMobileAccessRequest asks the desktop user to approve a narrow grant.
func (s *Server) handleMobileAccessRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
		return
	}
	var request protocol.MobileAccessRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if !validID(request.DeviceID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid deviceId required", false))
		return
	}
	device, err := s.store.Device(r.Context(), request.DeviceID)
	if errors.Is(err, store.ErrDeviceNotFound) {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "desktop device not found", false))
		return
	}
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load desktop device", true))
		return
	}
	if device.Device.Status == "revoked" || device.Device.Status == "waiting_desktop_authorization" {
		writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "desktop device is not available for access", false))
		return
	}
	workspaces, workspaceError := selectGrantedWorkspaces(device.Device.Workspaces, request.Workspaces)
	if workspaceError != nil {
		writeAPIError(w, *workspaceError)
		return
	}
	scopes, scopeError := selectGrantedScopes(device.Device.Scopes, request.Scopes)
	if scopeError != nil {
		writeAPIError(w, *scopeError)
		return
	}
	access, accessError := s.policyAccessForUser(r.Context(), actor.User.ID)
	if accessError != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not resolve user access policy", true))
		return
	}
	if !access.allowsRequest(device.Device.DeviceID, request.Workspaces, request.Scopes) {
		writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "the user access policy does not allow this request", false))
		return
	}

	grantID, err := randomToken("mag_")
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate access grant", true))
		return
	}
	now := nowUTC()
	record, err := s.store.RequestMobileAccess(r.Context(), store.MobileAccessGrantRecord{
		ID:             grantID,
		MobileDeviceID: actor.Device.Device.MobileDeviceID,
		DeviceID:       device.Device.DeviceID,
		UserID:         actor.User.ID,
		Workspaces:     workspaces,
		Scopes:         scopes,
	}, now)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not persist access request", true))
		return
	}
	s.audit(store.AuditEntry{
		OccurredAt: now,
		Actor:      "user:" + actor.User.ID,
		Action:     "mobile.access.request",
		DeviceID:   actor.Device.Device.MobileDeviceID,
		Result:     "success",
		SourceIP:   sourceIP(r),
	})
	grant := mobileGrantProjection(record, actor, device.Device)
	writeJSON(w, http.StatusCreated, grant)
}

// handleMobileAccessRevoke lets the phone withdraw its own request or grant.
func (s *Server) handleMobileAccessRevoke(w http.ResponseWriter, r *http.Request) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
		return
	}
	grantID := r.PathValue("grantId")
	if !validID(grantID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid grantId required", false))
		return
	}
	grant, err := s.store.MobileAccessGrantByID(r.Context(), grantID)
	if errors.Is(err, store.ErrMobileGrantNotFound) || (err == nil && grant.MobileDeviceID != actor.Device.Device.MobileDeviceID) {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "access grant not found", false))
		return
	}
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load access grant", true))
		return
	}
	now := nowUTC()
	err = s.store.RevokeMobileAccessGrantByID(r.Context(), grantID, actor.Device.Device.MobileDeviceID, now)
	if errors.Is(err, store.ErrMobileGrantNotFound) {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "access grant not found", false))
		return
	}
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not revoke access grant", true))
		return
	}
	s.events.CloseMobileForDevice(actor.Device.Device.MobileDeviceID, grant.DeviceID)
	s.audit(store.AuditEntry{
		OccurredAt: now,
		Actor:      "user:" + actor.User.ID,
		Action:     "mobile.access.revoke",
		DeviceID:   actor.Device.Device.MobileDeviceID,
		Result:     "success",
		SourceIP:   sourceIP(r),
	})
	w.WriteHeader(http.StatusNoContent)
}

// handleMobileWorkspaces flattens active grants into a workspace directory.
func (s *Server) handleMobileWorkspaces(w http.ResponseWriter, r *http.Request) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
		return
	}
	grants, err := s.store.MobileAccessGrantsForMobile(r.Context(), actor.Device.Device.MobileDeviceID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load mobile access grants", true))
		return
	}
	access, err := s.policyAccessForUser(r.Context(), actor.User.ID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not resolve user access policy", true))
		return
	}
	workspaces := make([]protocol.MobileWorkspaceView, 0)
	for _, grant := range grants {
		if grant.Status != "active" {
			continue
		}
		device, err := s.store.Device(r.Context(), grant.DeviceID)
		if err != nil {
			continue
		}
		online := s.hub.Get(grant.DeviceID) != nil
		for _, workspace := range grant.Workspaces {
			allowedScopes := access.scopes(grant.DeviceID, workspace.ID)
			scopes := make([]string, 0, len(allowedScopes))
			for _, scope := range grant.Scopes {
				if hasScope(allowedScopes, scope) {
					scopes = append(scopes, scope)
				}
			}
			if len(scopes) == 0 {
				continue
			}
			workspaces = append(workspaces, protocol.MobileWorkspaceView{
				GrantID:    grant.ID,
				DeviceID:   grant.DeviceID,
				DeviceName: device.Device.DeviceName,
				Workspace:  protocol.MobileWorkspaceSummary{ID: workspace.ID, Name: workspace.Name},
				Scopes:     orderScopes(scopes),
				Online:     online,
			})
		}
	}
	sort.Slice(workspaces, func(i, j int) bool {
		if workspaces[i].DeviceID != workspaces[j].DeviceID {
			return workspaces[i].DeviceID < workspaces[j].DeviceID
		}
		return workspaces[i].Workspace.Name < workspaces[j].Workspace.Name
	})
	writeJSON(w, http.StatusOK, protocol.MobileWorkspaceListResponse{Workspaces: workspaces})
}

type connectorSessionSummary struct {
	ID          string    `json:"id"`
	SessionID   string    `json:"sessionId"`
	Title       string    `json:"title"`
	WorkspaceID string    `json:"workspaceId"`
	Status      string    `json:"status"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type connectorSessionList struct {
	Sessions []connectorSessionSummary `json:"sessions"`
}

// handleMobileSessionList aggregates session metadata from every desktop with
// an active read grant. Sessions outside the phone's granted workspaces are
// filtered out locally even though the desktop only returns authorized ones.
func (s *Server) handleMobileSessionList(w http.ResponseWriter, r *http.Request) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
		return
	}
	deviceFilter := r.URL.Query().Get("deviceId")
	workspaceFilter := r.URL.Query().Get("workspaceId")
	if (deviceFilter != "" && !validID(deviceFilter)) || (workspaceFilter != "" && !validID(workspaceFilter)) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid deviceId and workspaceId required", false))
		return
	}
	grants, err := s.store.MobileAccessGrantsForMobile(r.Context(), actor.Device.Device.MobileDeviceID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load mobile access grants", true))
		return
	}
	access, err := s.policyAccessForUser(r.Context(), actor.User.ID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not resolve user access policy", true))
		return
	}
	type workspaceAccess struct {
		summary protocol.MobileWorkspaceSummary
		scopes  []string
	}
	type accessGroup struct {
		deviceID   string
		workspaces map[string]workspaceAccess
	}
	groups := make(map[string]*accessGroup)
	for _, grant := range grants {
		if grant.Status != "active" || !hasScope(grant.Scopes, "read") {
			continue
		}
		if deviceFilter != "" && grant.DeviceID != deviceFilter {
			continue
		}
		group := groups[grant.DeviceID]
		if group == nil {
			group = &accessGroup{deviceID: grant.DeviceID, workspaces: make(map[string]workspaceAccess)}
			groups[grant.DeviceID] = group
		}
		for _, workspace := range grant.Workspaces {
			if workspaceFilter != "" && workspace.ID != workspaceFilter {
				continue
			}
			allowedScopes := access.scopes(grant.DeviceID, workspace.ID)
			if !hasScope(allowedScopes, "read") {
				continue
			}
			effectiveScopes := make([]string, 0, len(allowedScopes))
			for _, scope := range grant.Scopes {
				if hasScope(allowedScopes, scope) {
					effectiveScopes = append(effectiveScopes, scope)
				}
			}
			group.workspaces[workspace.ID] = workspaceAccess{
				summary: protocol.MobileWorkspaceSummary{ID: workspace.ID, Name: workspace.Name},
				scopes:  orderScopes(effectiveScopes),
			}
		}
		if len(group.workspaces) == 0 {
			delete(groups, grant.DeviceID)
		}
	}
	if deviceFilter != "" {
		if _, exists := groups[deviceFilter]; !exists {
			writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "no active read access for this desktop", false))
			return
		}
	}

	sessions := make([]protocol.MobileSessionView, 0)
	warnings := make([]protocol.MobileAccessWarning, 0)
	for _, group := range groups {
		if len(group.workspaces) == 0 {
			continue
		}
		device, err := s.store.Device(r.Context(), group.deviceID)
		if err != nil {
			continue
		}
		requestID, err := randomToken("req_")
		if err != nil {
			continue
		}
		result, commandError := s.router.Execute(r.Context(), protocol.MethodSessionList, group.deviceID, requestID, map[string]any{}, s.config.CommandTimeout)
		if commandError != nil {
			warnings = append(warnings, protocol.MobileAccessWarning{
				DeviceID:   group.deviceID,
				DeviceName: device.Device.DeviceName,
				Code:       commandError.Code,
				Message:    commandError.Message,
			})
			continue
		}
		var listed connectorSessionList
		if err := json.Unmarshal(result, &listed); err != nil {
			warnings = append(warnings, protocol.MobileAccessWarning{
				DeviceID:   group.deviceID,
				DeviceName: device.Device.DeviceName,
				Code:       protocol.CodeInternalError,
				Message:    "desktop returned an invalid session list",
			})
			continue
		}
		for _, summary := range listed.Sessions {
			workspace, allowed := group.workspaces[summary.WorkspaceID]
			if !allowed {
				continue
			}
			sessionID := summary.SessionID
			if sessionID == "" {
				sessionID = summary.ID
			}
			if !validID(sessionID) {
				continue
			}
			title := summary.Title
			if title == "" {
				title = sessionID
			}
			sessions = append(sessions, protocol.MobileSessionView{
				SessionID:     sessionID,
				Title:         title,
				WorkspaceID:   summary.WorkspaceID,
				WorkspaceName: workspace.summary.Name,
				DeviceID:      group.deviceID,
				DeviceName:    device.Device.DeviceName,
				Status:        summary.Status,
				Scopes:        orderScopes(workspace.scopes),
				UpdatedAt:     summary.UpdatedAt,
			})
		}
	}
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt.After(sessions[j].UpdatedAt)
	})
	if warnings == nil {
		warnings = []protocol.MobileAccessWarning{}
	}
	writeJSON(w, http.StatusOK, protocol.MobileSessionListResponse{Sessions: sessions, Warnings: warnings})
}

// handleMobileSessionCreate creates a session in a workspace explicitly granted
// to this phone. The first prompt is sent separately with its own requestId.
func (s *Server) handleMobileSessionCreate(w http.ResponseWriter, r *http.Request) {
	var request protocol.MobileSessionCreateRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if !validID(request.RequestID) || !validID(request.DeviceID) || !validID(request.WorkspaceID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "requestId, deviceId and workspaceId are required", false))
		return
	}
	actor, commandError := s.authorizeMobileSession(r, request.DeviceID, request.WorkspaceID, "", "prompt")
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	params := map[string]string{"workspaceId": request.WorkspaceID}
	result, commandError := s.router.Execute(
		r.Context(), protocol.MethodSessionCreate, request.DeviceID, request.RequestID, params,
		time.Duration(request.TimeoutMS)*time.Millisecond,
	)
	var created protocol.SessionCreateResult
	if commandError == nil {
		if err := json.Unmarshal(result, &created); err != nil || !validID(created.SessionID) || created.WorkspaceID != request.WorkspaceID {
			commandError = errorPtr(protocol.NewError(protocol.CodeInternalError, "desktop returned an invalid session creation result", false))
		}
	}
	s.auditMobileSession(actor, r, "mobile.session.create", request.DeviceID, created.SessionID, commandError)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

type connectorTranscript struct {
	Messages   []protocol.MobileMessage `json:"messages"`
	HasMore    bool                     `json:"hasMore"`
	NextCursor string                   `json:"nextCursor,omitempty"`
	Active     bool                     `json:"active"`
	TurnEndSeq uint64                   `json:"turnEndSeq,omitempty"`
	Truncated  bool                     `json:"truncated,omitempty"`
}

// handleMobileSessionMessages returns a normalized transcript from the desktop.
func (s *Server) handleMobileSessionMessages(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("sessionId")
	deviceID := r.URL.Query().Get("deviceId")
	workspaceID := r.URL.Query().Get("workspaceId")
	cursor := r.URL.Query().Get("cursor")
	if !validID(sessionID) || !validID(deviceID) || !validID(workspaceID) || len(cursor) > 4096 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "sessionId, deviceId and workspaceId are required", false))
		return
	}
	limit := 30
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "limit must be between 1 and 100", false))
			return
		}
		limit = parsed
	}
	_, commandError := s.authorizeMobileSession(r, deviceID, workspaceID, sessionID, "read")
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	params := map[string]any{"sessionId": sessionID, "workspaceId": workspaceID, "limit": limit}
	if cursor != "" {
		params["cursor"] = cursor
	}
	requestID, err := randomToken("req_")
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate requestId", true))
		return
	}
	result, commandError := s.router.Execute(r.Context(), protocol.MethodSessionTranscript, deviceID, requestID, params, s.config.CommandTimeout)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	var transcript connectorTranscript
	if err := json.Unmarshal(result, &transcript); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "desktop returned an invalid transcript", false))
		return
	}
	if transcript.Messages == nil {
		transcript.Messages = []protocol.MobileMessage{}
	}
	// Learn every attachment the desktop declared, then overwrite the state with
	// the Server-owned value so all phones agree on one attachment's fate.
	if s.attachmentsEnabled() {
		s.learnTranscriptAttachments(r.Context(), deviceID, workspaceID, sessionID, transcript.Messages)
	}
	writeJSON(w, http.StatusOK, protocol.MobileTranscriptResponse{
		SessionID:   sessionID,
		DeviceID:    deviceID,
		WorkspaceID: workspaceID,
		Messages:    transcript.Messages,
		HasMore:     transcript.HasMore,
		NextCursor:  transcript.NextCursor,
		Active:      transcript.Active,
		TurnEndSeq:  transcript.TurnEndSeq,
		Truncated:   transcript.Truncated,
	})
}

// handleMobileSessionModel returns the current Session selection and the
// display-safe catalog without activating a cold Agent on the desktop.
func (s *Server) handleMobileSessionModel(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("sessionId")
	deviceID := r.URL.Query().Get("deviceId")
	workspaceID := r.URL.Query().Get("workspaceId")
	if !validID(sessionID) || !validID(deviceID) || !validID(workspaceID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "sessionId, deviceId and workspaceId are required", false))
		return
	}
	if _, commandError := s.authorizeMobileSession(r, deviceID, workspaceID, sessionID, "read"); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	requestID, err := randomToken("req_")
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate requestId", true))
		return
	}
	params := map[string]string{"sessionId": sessionID, "workspaceId": workspaceID}
	result, commandError := s.router.Execute(r.Context(), protocol.MethodSessionModelCatalog, deviceID, requestID, params, s.config.CommandTimeout)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	var catalog protocol.MobileModelCatalogResponse
	if err := json.Unmarshal(result, &catalog); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "desktop returned an invalid model catalog", false))
		return
	}
	normalizeMobileModelCatalog(&catalog)
	if catalog.SessionID != sessionID || catalog.DeviceID != deviceID || catalog.WorkspaceID != workspaceID ||
		(catalog.ProjectionKind != "sequenced" && catalog.ProjectionKind != "migration-required") ||
		!validModelSelection(catalog.Default) || !validModelSelection(catalog.Effective) ||
		(catalog.LastUsed != nil && !validModelSelection(*catalog.LastUsed)) ||
		(catalog.Next != nil && !validModelSelection(*catalog.Next)) {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "desktop returned an inconsistent model catalog", false))
		return
	}
	writeJSON(w, http.StatusOK, catalog)
}

func (s *Server) handleMobileSessionModelSelect(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("sessionId")
	var request protocol.MobileModelSelectRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if !validID(request.RequestID) || !validID(request.DeviceID) || !validID(request.WorkspaceID) || !validID(sessionID) ||
		!validText(request.Provider, 128) || !validText(request.Model, 256) ||
		(request.ReasoningEffort != nil && !validText(*request.ReasoningEffort, 64)) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "requestId, deviceId, workspaceId, sessionId, provider, model and reasoningEffort are invalid", false))
		return
	}
	actor, commandError := s.authorizeMobileSession(r, request.DeviceID, request.WorkspaceID, sessionID, "prompt")
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	params := map[string]any{
		"sessionId":   sessionID,
		"workspaceId": request.WorkspaceID,
		"provider":    request.Provider,
		"model":       request.Model,
	}
	if request.ReasoningEffort != nil {
		params["reasoningEffort"] = *request.ReasoningEffort
	}
	result, commandError := s.router.Execute(
		r.Context(), protocol.MethodSessionModelSelect, request.DeviceID, request.RequestID, params,
		time.Duration(request.TimeoutMS)*time.Millisecond,
	)
	var selected protocol.MobileModelSelectResponse
	if commandError == nil {
		expected := protocol.ModelSelection{Provider: request.Provider, Model: request.Model, ReasoningEffort: request.ReasoningEffort}
		if err := json.Unmarshal(result, &selected); err != nil || selected.SessionID != sessionID || selected.RequestID != request.RequestID ||
			!validModelSelection(selected.Selected) || !sameModelSelection(selected.Selected, expected) {
			commandError = errorPtr(protocol.NewError(protocol.CodeInternalError, "desktop returned an invalid model selection result", false))
		}
	}
	s.auditMobileSession(actor, r, "mobile.session.model.select", request.DeviceID, sessionID, commandError)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	writeJSON(w, http.StatusOK, selected)
}

func normalizeMobileModelCatalog(catalog *protocol.MobileModelCatalogResponse) {
	if catalog.RoutableProviders == nil {
		catalog.RoutableProviders = []string{}
	}
	if catalog.Groups == nil {
		catalog.Groups = []protocol.MobileModelProviderGroup{}
	}
	if catalog.Failures == nil {
		catalog.Failures = []protocol.MobileModelCatalogFailure{}
	}
	for groupIndex := range catalog.Groups {
		group := &catalog.Groups[groupIndex]
		if group.Models == nil {
			group.Models = []protocol.MobileModel{}
		}
		for modelIndex := range group.Models {
			reasoning := group.Models[modelIndex].Reasoning
			if reasoning != nil && reasoning.Efforts == nil {
				reasoning.Efforts = []protocol.MobileModelReasoningEffort{}
			}
		}
	}
}

func validModelSelection(selection protocol.ModelSelection) bool {
	return validText(selection.Provider, 128) && validText(selection.Model, 256) &&
		(selection.ReasoningEffort == nil || validText(*selection.ReasoningEffort, 64))
}

func sameModelSelection(left, right protocol.ModelSelection) bool {
	if left.Provider != right.Provider || left.Model != right.Model {
		return false
	}
	if left.ReasoningEffort == nil || right.ReasoningEffort == nil {
		return left.ReasoningEffort == nil && right.ReasoningEffort == nil
	}
	return *left.ReasoningEffort == *right.ReasoningEffort
}

func (s *Server) handleMobileSessionPrompt(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("sessionId")
	var request protocol.MobilePromptRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if !validID(request.RequestID) || !validID(request.DeviceID) || !validID(request.WorkspaceID) || !validID(sessionID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "requestId, deviceId, workspaceId and sessionId are required", false))
		return
	}
	if request.Mode != "queue" && request.Mode != "steer" {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "mode must be queue or steer", false))
		return
	}
	if !validText(request.Text, 64*1024) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "text is required and limited to 64 KiB", false))
		return
	}
	actor, commandError := s.authorizeMobileSession(r, request.DeviceID, request.WorkspaceID, sessionID, "prompt")
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	params := map[string]any{
		"sessionId":      sessionID,
		"mode":           request.Mode,
		"content":        []protocol.ContentPart{{Type: "text", Text: request.Text}},
		"clientTimeZone": "UTC",
	}
	result, commandError := s.router.Execute(
		r.Context(), protocol.MethodSessionPrompt, request.DeviceID, request.RequestID, params,
		time.Duration(request.TimeoutMS)*time.Millisecond,
	)
	s.auditMobileSession(actor, r, "mobile.session.prompt", request.DeviceID, sessionID, commandError)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	writeRawJSON(w, http.StatusOK, result)
}

func (s *Server) handleMobileSessionCancel(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("sessionId")
	var request protocol.MobileCancelRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if !validID(request.RequestID) || !validID(request.DeviceID) || !validID(request.WorkspaceID) || !validID(sessionID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "requestId, deviceId, workspaceId and sessionId are required", false))
		return
	}
	actor, commandError := s.authorizeMobileSession(r, request.DeviceID, request.WorkspaceID, sessionID, "cancel")
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	params := map[string]string{"sessionId": sessionID}
	result, commandError := s.router.Execute(
		r.Context(), protocol.MethodSessionCancel, request.DeviceID, request.RequestID, params,
		time.Duration(request.TimeoutMS)*time.Millisecond,
	)
	s.auditMobileSession(actor, r, "mobile.session.cancel", request.DeviceID, sessionID, commandError)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	writeRawJSON(w, http.StatusOK, result)
}

// authorizeMobileSession verifies that this phone has an active grant for the
// desktop, workspace and required scope. The Connector independently validates
// the session's real workspace ownership.
func (s *Server) authorizeMobileSession(r *http.Request, deviceID, workspaceID, sessionID, scope string) (mobileActor, *protocol.Error) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		return mobileActor{}, errorPtr(protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
	}
	_ = sessionID
	grant, err := s.store.MobileAccessGrant(r.Context(), actor.Device.Device.MobileDeviceID, deviceID)
	if errors.Is(err, store.ErrMobileGrantNotFound) {
		return actor, errorPtr(protocol.NewError(protocol.CodeForbidden, "no access grant for this desktop", false))
	}
	if err != nil {
		return actor, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not load access grant", true))
	}
	if grant.Status != "active" {
		return actor, errorPtr(protocol.NewError(protocol.CodeForbidden, "desktop access is not active", false))
	}
	if !hasScope(grant.Scopes, scope) {
		return actor, errorPtr(protocol.NewError(protocol.CodeForbidden, "the access grant does not include this action", false))
	}
	allowed := false
	for _, workspace := range grant.Workspaces {
		if workspace.ID == workspaceID {
			allowed = true
			break
		}
	}
	if !allowed {
		return actor, errorPtr(protocol.NewError(protocol.CodeForbidden, "the workspace is not granted to this phone", false))
	}
	access, err := s.policyAccessForUser(r.Context(), actor.User.ID)
	if err != nil {
		return actor, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not resolve user access policy", true))
	}
	if !access.allows(deviceID, workspaceID, scope) {
		return actor, errorPtr(protocol.NewError(protocol.CodeForbidden, "the user access policy does not include this action", false))
	}
	return actor, nil
}

func (s *Server) auditMobileSession(actor mobileActor, r *http.Request, action, deviceID, sessionID string, commandError *protocol.Error) {
	auditResult := "success"
	errorCode := ""
	if commandError != nil {
		auditResult = "error"
		errorCode = commandError.Code
	}
	s.audit(store.AuditEntry{
		OccurredAt: nowUTC(),
		Actor:      "user:" + actor.User.ID,
		Action:     action,
		DeviceID:   deviceID,
		SessionID:  sessionID,
		Result:     auditResult,
		ErrorCode:  errorCode,
		SourceIP:   sourceIP(r),
	})
}

// ---------- Connector reverse RPC ----------

// handleConnectorRequest serves desktop-scoped control-plane calls over the
// Connector's authenticated WSS. Only an authenticated Connector may call it,
// and every query is scoped to that Connector's device id.
func (s *Server) handleConnectorRequest(ctx context.Context, connection *connectorConn, request protocol.ConnectorRequest) (any, *protocol.Error) {
	if !validID(request.RequestID) || !validText(request.Method, 128) {
		return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "requestId and method are required", false))
	}
	switch request.Method {
	case protocol.ConnectorMethodMobileAccessList:
		return s.connectorMobileAccessList(ctx, connection.deviceID)
	case protocol.ConnectorMethodMobileAccessDecide:
		return s.connectorMobileAccessDecide(ctx, connection.deviceID, request.Params)
	case protocol.ConnectorMethodPairUpdateGrants:
		return s.connectorUpdateGrants(ctx, connection.deviceID, request.Params)
	case protocol.ConnectorMethodInteractionAudience:
		return s.connectorInteractionAudience(ctx, connection.deviceID, request.Params)
	default:
		return nil, errorPtr(protocol.NewError(protocol.CodeMethodNotSupported, "unsupported Connector request method", false))
	}
}

// connectorUpdateGrants lets the desktop explicitly widen or narrow its own
// authorized workspaces and scopes without re-pairing. Phones keep their own
// grants; every later command still checks the device grant, so a narrowed
// desktop grant takes effect immediately.
func (s *Server) connectorUpdateGrants(ctx context.Context, deviceID string, params json.RawMessage) (protocol.Device, *protocol.Error) {
	var input protocol.ConnectorUpdateGrants
	if commandError := decodeRawJSON(params, &input); commandError != nil {
		return protocol.Device{}, commandError
	}
	if !validGrants(input.Workspaces, input.Scopes) {
		return protocol.Device{}, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "invalid workspaces or scopes", false))
	}
	record, err := s.store.Device(ctx, deviceID)
	if errors.Is(err, store.ErrDeviceNotFound) {
		return protocol.Device{}, errorPtr(protocol.NewError(protocol.CodeNotFound, "desktop device not found", false))
	}
	if err != nil {
		return protocol.Device{}, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not load desktop device", true))
	}
	if record.Device.Status == "revoked" || record.Device.Status == "waiting_desktop_authorization" {
		return protocol.Device{}, errorPtr(protocol.NewError(protocol.CodeForbidden, "desktop device cannot update grants", false))
	}
	updated, err := s.store.UpdateDeviceGrants(ctx, deviceID, input.Workspaces, input.Scopes, nowUTC())
	if err != nil {
		return protocol.Device{}, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not update desktop grants", true))
	}
	s.events.CloseDevice(deviceID)
	s.audit(store.AuditEntry{OccurredAt: nowUTC(), Actor: "connector", Action: "pair.grants.update", DeviceID: deviceID, Result: "success"})
	return updated.Device, nil
}

func (s *Server) connectorMobileAccessList(ctx context.Context, deviceID string) (protocol.ConnectorMobileAccessListResponse, *protocol.Error) {
	device, err := s.store.Device(ctx, deviceID)
	if errors.Is(err, store.ErrDeviceNotFound) {
		return protocol.ConnectorMobileAccessListResponse{}, errorPtr(protocol.NewError(protocol.CodeNotFound, "desktop device not found", false))
	}
	if err != nil {
		return protocol.ConnectorMobileAccessListResponse{}, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not load desktop device", true))
	}
	grants, err := s.store.MobileAccessGrantsForDevice(ctx, deviceID)
	if err != nil {
		return protocol.ConnectorMobileAccessListResponse{}, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not load mobile access grants", true))
	}
	projections := make([]protocol.MobileAccessGrant, 0, len(grants))
	for _, grant := range grants {
		projection := protocol.MobileAccessGrant{
			GrantID:        grant.ID,
			MobileDeviceID: grant.MobileDeviceID,
			DeviceID:       grant.DeviceID,
			DeviceName:     device.Device.DeviceName,
			Workspaces:     mobileWorkspaceSummaries(grant.Workspaces),
			Scopes:         orderScopes(grant.Scopes),
			Status:         grant.Status,
			CreatedAt:      grant.CreatedAt,
			UpdatedAt:      grant.UpdatedAt,
			DecidedAt:      grant.DecidedAt,
		}
		if mobileDevice, err := s.store.MobileDeviceByID(ctx, grant.MobileDeviceID); err == nil {
			projection.MobileDeviceName = mobileDevice.Device.DeviceName
			projection.MobilePlatform = mobileDevice.Device.Platform
		}
		if owner, err := s.store.UserByID(ctx, grant.UserID); err == nil {
			projection.MobileUserName = owner.DisplayName
		}
		projections = append(projections, projection)
	}
	return protocol.ConnectorMobileAccessListResponse{
		Grants:              projections,
		AvailableWorkspaces: mobileWorkspaceSummaries(device.Device.Workspaces),
		AvailableScopes:     orderScopes(device.Device.Scopes),
	}, nil
}

func (s *Server) connectorMobileAccessDecide(ctx context.Context, deviceID string, params json.RawMessage) (protocol.MobileAccessGrant, *protocol.Error) {
	var decision protocol.ConnectorMobileAccessDecision
	if commandError := decodeRawJSON(params, &decision); commandError != nil {
		return protocol.MobileAccessGrant{}, commandError
	}
	if !validID(decision.MobileDeviceID) {
		return protocol.MobileAccessGrant{}, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "valid mobileDeviceId required", false))
	}
	var status string
	switch decision.Action {
	case "allow":
		status = "active"
	case "deny":
		status = "denied"
	case "revoke":
		status = "revoked"
	default:
		return protocol.MobileAccessGrant{}, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "action must be allow, deny or revoke", false))
	}
	device, err := s.store.Device(ctx, deviceID)
	if errors.Is(err, store.ErrDeviceNotFound) {
		return protocol.MobileAccessGrant{}, errorPtr(protocol.NewError(protocol.CodeNotFound, "desktop device not found", false))
	}
	if err != nil {
		return protocol.MobileAccessGrant{}, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not load desktop device", true))
	}
	grant, err := s.store.MobileAccessGrant(ctx, decision.MobileDeviceID, deviceID)
	if errors.Is(err, store.ErrMobileGrantNotFound) {
		return protocol.MobileAccessGrant{}, errorPtr(protocol.NewError(protocol.CodeNotFound, "mobile access request not found", false))
	}
	if err != nil {
		return protocol.MobileAccessGrant{}, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not load mobile access request", true))
	}

	if status == "active" {
		requestedWorkspaces := make(map[string]struct{}, len(grant.Workspaces))
		for _, workspace := range grant.Workspaces {
			requestedWorkspaces[workspace.ID] = struct{}{}
		}
		for _, workspaceID := range decision.Workspaces {
			if _, requested := requestedWorkspaces[workspaceID]; !requested {
				return protocol.MobileAccessGrant{}, errorPtr(protocol.NewError(protocol.CodeForbidden, "the desktop can only narrow the requested workspaces", false))
			}
		}
		requestedScopes := make(map[string]struct{}, len(grant.Scopes))
		for _, scope := range grant.Scopes {
			requestedScopes[scope] = struct{}{}
		}
		for _, scope := range decision.Scopes {
			if _, requested := requestedScopes[scope]; !requested {
				return protocol.MobileAccessGrant{}, errorPtr(protocol.NewError(protocol.CodeForbidden, "the desktop can only narrow the requested actions", false))
			}
		}
	}

	workspaces := grant.Workspaces
	scopes := grant.Scopes
	if status == "active" {
		selectedWorkspaces, workspaceError := selectGrantedWorkspaces(device.Device.Workspaces, decision.Workspaces)
		if workspaceError != nil {
			return protocol.MobileAccessGrant{}, workspaceError
		}
		selectedScopes, scopeError := selectGrantedScopes(device.Device.Scopes, decision.Scopes)
		if scopeError != nil {
			return protocol.MobileAccessGrant{}, scopeError
		}
		workspaces = selectedWorkspaces
		scopes = selectedScopes
	}
	now := nowUTC()
	updated, err := s.store.DecideMobileAccessGrant(ctx, decision.MobileDeviceID, deviceID, status, workspaces, scopes, now)
	if errors.Is(err, store.ErrMobileGrantState) {
		return protocol.MobileAccessGrant{}, errorPtr(protocol.NewError(protocol.CodeConflict, "mobile access request is no longer pending", false))
	}
	if err != nil {
		return protocol.MobileAccessGrant{}, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not decide mobile access request", true))
	}
	if status != "active" {
		s.events.CloseMobileForDevice(decision.MobileDeviceID, deviceID)
	}
	action := "mobile.access." + decision.Action
	s.audit(store.AuditEntry{
		OccurredAt: now,
		Actor:      "desktop:" + deviceID,
		Action:     action,
		DeviceID:   deviceID,
		Result:     "success",
	})
	return protocol.MobileAccessGrant{
		GrantID:        updated.ID,
		MobileDeviceID: updated.MobileDeviceID,
		DeviceID:       updated.DeviceID,
		DeviceName:     device.Device.DeviceName,
		Workspaces:     mobileWorkspaceSummaries(updated.Workspaces),
		Scopes:         orderScopes(updated.Scopes),
		Status:         updated.Status,
		CreatedAt:      updated.CreatedAt,
		UpdatedAt:      updated.UpdatedAt,
		DecidedAt:      updated.DecidedAt,
	}, nil
}

// ---------- small helpers ----------

func mobileGrantProjection(grant store.MobileAccessGrantRecord, actor mobileActor, device protocol.Device) protocol.MobileAccessGrant {
	return protocol.MobileAccessGrant{
		GrantID:          grant.ID,
		MobileDeviceID:   grant.MobileDeviceID,
		MobileDeviceName: actor.Device.Device.DeviceName,
		MobileUserName:   actor.User.DisplayName,
		MobilePlatform:   actor.Device.Device.Platform,
		DeviceID:         grant.DeviceID,
		DeviceName:       device.DeviceName,
		Workspaces:       mobileWorkspaceSummaries(grant.Workspaces),
		Scopes:           orderScopes(grant.Scopes),
		Status:           grant.Status,
		CreatedAt:        grant.CreatedAt,
		UpdatedAt:        grant.UpdatedAt,
		DecidedAt:        grant.DecidedAt,
	}
}

func mobileWorkspaceSummaries(values []protocol.Workspace) []protocol.MobileWorkspaceSummary {
	result := make([]protocol.MobileWorkspaceSummary, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, workspace := range values {
		if workspace.ID == "" {
			continue
		}
		if _, exists := seen[workspace.ID]; exists {
			continue
		}
		seen[workspace.ID] = struct{}{}
		name := workspace.Name
		if name == "" {
			name = workspace.ID
		}
		result = append(result, protocol.MobileWorkspaceSummary{ID: workspace.ID, Name: name})
	}
	return result
}

func selectGrantedWorkspaces(available []protocol.Workspace, requested []string) ([]protocol.Workspace, *protocol.Error) {
	if len(requested) == 0 {
		return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "select at least one workspace", false))
	}
	byID := make(map[string]protocol.Workspace, len(available))
	for _, workspace := range available {
		byID[workspace.ID] = workspace
	}
	result := make([]protocol.Workspace, 0, len(requested))
	seen := make(map[string]struct{}, len(requested))
	for _, id := range requested {
		if !validID(id) {
			return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "invalid workspace id", false))
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		workspace, exists := byID[id]
		if !exists {
			return nil, errorPtr(protocol.NewError(protocol.CodeForbidden, "workspace is not authorized on this desktop", false))
		}
		seen[id] = struct{}{}
		result = append(result, workspace)
	}
	if len(result) == 0 {
		return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "select at least one workspace", false))
	}
	return result, nil
}

func selectGrantedScopes(available []string, requested []string) ([]string, *protocol.Error) {
	if len(requested) == 0 {
		return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "select at least one action", false))
	}
	byName := make(map[string]struct{}, len(available))
	for _, scope := range available {
		byName[scope] = struct{}{}
	}
	seen := make(map[string]struct{}, len(requested))
	for _, scope := range requested {
		if scope != "read" && scope != "prompt" && scope != "approve" && scope != "cancel" {
			return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "unsupported scope", false))
		}
		if _, duplicate := seen[scope]; duplicate {
			continue
		}
		if _, allowed := byName[scope]; !allowed {
			return nil, errorPtr(protocol.NewError(protocol.CodeForbidden, "scope is not authorized on this desktop", false))
		}
		seen[scope] = struct{}{}
	}
	if len(seen) == 0 {
		return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "select at least one action", false))
	}
	result := make([]string, 0, len(seen))
	for _, scope := range canonicalScopes {
		if _, allowed := seen[scope]; allowed {
			result = append(result, scope)
		}
	}
	return result, nil
}

func policyScopeUnion(workspaces map[string]map[string]struct{}, deviceScopes []string) []string {
	allowed := make(map[string]struct{})
	for _, scopes := range workspaces {
		for scope := range scopes {
			if hasScope(deviceScopes, scope) {
				allowed[scope] = struct{}{}
			}
		}
	}
	result := make([]string, 0, len(allowed))
	for scope := range allowed {
		result = append(result, scope)
	}
	return orderScopes(result)
}

func policyGrantScopes(grant store.MobileAccessGrantRecord, access policyAccess) []string {
	allowed := make(map[string]struct{})
	for _, workspace := range grant.Workspaces {
		for _, scope := range access.scopes(grant.DeviceID, workspace.ID) {
			if hasScope(grant.Scopes, scope) {
				allowed[scope] = struct{}{}
			}
		}
	}
	result := make([]string, 0, len(allowed))
	for scope := range allowed {
		result = append(result, scope)
	}
	return orderScopes(result)
}

// orderScopes keeps user-facing action order stable regardless of storage order.
func orderScopes(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, scope := range canonicalScopes {
		for _, value := range values {
			if value == scope {
				if _, duplicate := seen[value]; !duplicate {
					seen[value] = struct{}{}
					result = append(result, value)
				}
			}
		}
	}
	for _, value := range values {
		if _, duplicate := seen[value]; duplicate {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

var canonicalScopes = []string{"read", "prompt", "approve", "cancel"}

func hasScope(scopes []string, scope string) bool {
	for _, value := range scopes {
		if value == scope {
			return true
		}
	}
	return false
}

func decodeRawJSON(raw json.RawMessage, destination any) *protocol.Error {
	if len(raw) == 0 || !json.Valid(raw) {
		return errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "invalid JSON params", false))
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "invalid JSON params", false))
	}
	return nil
}
