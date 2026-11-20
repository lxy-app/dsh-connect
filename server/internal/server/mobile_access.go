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
	mux.HandleFunc("GET /v1/mobile/workspaces", s.mobileAuth(s.handleMobileWorkspaces))
	mux.HandleFunc("GET /v1/mobile/sessions", s.mobileAuth(s.handleMobileSessionList))
	mux.HandleFunc("POST /v1/mobile/sessions", s.mobileAuth(s.handleMobileSessionCreate))
	mux.HandleFunc("GET /v1/mobile/sessions/{sessionId}/messages", s.mobileAuth(s.handleMobileSessionMessages))
	mux.HandleFunc("GET /v1/mobile/sessions/{sessionId}/model", s.mobileAuth(s.handleMobileSessionModel))
	mux.HandleFunc("POST /v1/mobile/sessions/{sessionId}/model", s.mobileAuth(s.handleMobileSessionModelSelect))
	mux.HandleFunc("POST /v1/mobile/sessions/{sessionId}/prompt", s.mobileAuth(s.handleMobileSessionPrompt))
	mux.HandleFunc("POST /v1/mobile/sessions/{sessionId}/cancel", s.mobileAuth(s.handleMobileSessionCancel))
}

type mobileUserWorkspaceAccess struct {
	summary protocol.MobileWorkspaceSummary
	scopes  []string
}

type mobileUserDesktopAccess struct {
	device     protocol.Device
	workspaces []mobileUserWorkspaceAccess
}

// mobileUserDesktops resolves the only mobile authorization source: enabled
// user policies intersected with the workspaces and scopes currently exposed by
// each Connector. Mobile device identity never adds or removes permissions.
func (s *Server) mobileUserDesktops(ctx context.Context, userID string) ([]mobileUserDesktopAccess, error) {
	access, err := s.policyAccessForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	devices, err := s.store.Devices(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]mobileUserDesktopAccess, 0, len(devices))
	for _, record := range devices {
		device := record.Device
		if device.Status == "revoked" || device.Status == "waiting_desktop_authorization" {
			continue
		}
		allowedWorkspaces := access.workspaceScopes(device.DeviceID)
		if len(allowedWorkspaces) == 0 {
			continue
		}
		desktop := mobileUserDesktopAccess{
			device:     device,
			workspaces: make([]mobileUserWorkspaceAccess, 0, len(allowedWorkspaces)),
		}
		for _, workspace := range mobileWorkspaceSummaries(device.Workspaces) {
			allowedScopes, allowed := allowedWorkspaces[workspace.ID]
			if !allowed {
				continue
			}
			effectiveScopes := make([]string, 0, len(allowedScopes))
			for scope := range allowedScopes {
				if hasScope(device.Scopes, scope) {
					effectiveScopes = append(effectiveScopes, scope)
				}
			}
			if len(effectiveScopes) == 0 {
				continue
			}
			desktop.workspaces = append(desktop.workspaces, mobileUserWorkspaceAccess{
				summary: workspace,
				scopes:  orderScopes(effectiveScopes),
			})
		}
		if len(desktop.workspaces) > 0 {
			result = append(result, desktop)
		}
	}
	return result, nil
}

// handleMobileAccessOverview lists effective user permissions without exposing
// workspace filesystem paths.
func (s *Server) handleMobileAccessOverview(w http.ResponseWriter, r *http.Request) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
		return
	}
	accessible, err := s.mobileUserDesktops(r.Context(), actor.User.ID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not resolve user desktop access", true))
		return
	}
	desktops := make([]protocol.MobileDesktopAccess, 0, len(accessible))
	for _, current := range accessible {
		desktop := protocol.MobileDesktopAccess{
			DeviceID:            current.device.DeviceID,
			DeviceName:          current.device.DeviceName,
			ConnectorVersion:    current.device.ConnectorVersion,
			Online:              s.hub.Get(current.device.DeviceID) != nil,
			AvailableWorkspaces: make([]protocol.MobileWorkspaceSummary, 0, len(current.workspaces)),
		}
		scopeSet := make(map[string]struct{})
		for _, workspace := range current.workspaces {
			summary := workspace.summary
			summary.Scopes = append([]string(nil), workspace.scopes...)
			desktop.AvailableWorkspaces = append(desktop.AvailableWorkspaces, summary)
			for _, scope := range workspace.scopes {
				scopeSet[scope] = struct{}{}
			}
		}
		desktop.AvailableScopes = orderScopes(setKeys(scopeSet))
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

// handleMobileWorkspaces flattens effective user policies into a workspace directory.
func (s *Server) handleMobileWorkspaces(w http.ResponseWriter, r *http.Request) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
		return
	}
	accessible, err := s.mobileUserDesktops(r.Context(), actor.User.ID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not resolve user desktop access", true))
		return
	}
	workspaces := make([]protocol.MobileWorkspaceView, 0)
	for _, desktop := range accessible {
		for _, workspace := range desktop.workspaces {
			workspaces = append(workspaces, protocol.MobileWorkspaceView{
				DeviceID:   desktop.device.DeviceID,
				DeviceName: desktop.device.DeviceName,
				Workspace:  workspace.summary,
				Scopes:     workspace.scopes,
				Online:     s.hub.Get(desktop.device.DeviceID) != nil,
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
// an effective user read policy. Sessions outside the user's authorized workspaces
// are filtered locally even though the desktop only returns authorized ones.
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
	accessible, err := s.mobileUserDesktops(r.Context(), actor.User.ID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not resolve user desktop access", true))
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
	for _, desktop := range accessible {
		deviceID := desktop.device.DeviceID
		if deviceFilter != "" && deviceID != deviceFilter {
			continue
		}
		group := &accessGroup{deviceID: deviceID, workspaces: make(map[string]workspaceAccess)}
		for _, workspace := range desktop.workspaces {
			if workspaceFilter != "" && workspace.summary.ID != workspaceFilter {
				continue
			}
			if !hasScope(workspace.scopes, "read") {
				continue
			}
			group.workspaces[workspace.summary.ID] = workspaceAccess{
				summary: workspace.summary,
				scopes:  workspace.scopes,
			}
		}
		if len(group.workspaces) > 0 {
			groups[deviceID] = group
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

// handleMobileSessionCreate creates a session in a workspace allowed by the
// user's effective policy. The first prompt is sent separately with its own requestId.
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
	s.auditMobileSession(actor, r, "mobile.session.create", request.DeviceID, created.SessionID, request.RequestID, commandError)
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
	s.auditMobileSession(actor, r, "mobile.session.model.select", request.DeviceID, sessionID, request.RequestID, commandError)
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
	if !validText(request.Text, 64*1024) && len(request.Attachments) == 0 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "text or attachments are required", false))
		return
	}
	if request.Text != "" && !validText(request.Text, 64*1024) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "text is limited to 64 KiB", false))
		return
	}
	actor, commandError := s.authorizeMobileSession(r, request.DeviceID, request.WorkspaceID, sessionID, "prompt")
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	content := make([]protocol.ContentPart, 0, len(request.Attachments)+1)
	if request.Text != "" {
		content = append(content, protocol.ContentPart{Type: "text", Text: request.Text})
	}
	attachmentParts, attachmentError := s.promptAttachmentParts(r, actor.Device.Device.MobileDeviceID, request.DeviceID, request.WorkspaceID, sessionID, request.Attachments)
	if attachmentError != nil {
		writeAPIError(w, *attachmentError)
		return
	}
	content = append(content, attachmentParts...)
	params := map[string]any{
		"sessionId":      sessionID,
		"mode":           request.Mode,
		"content":        content,
		"clientTimeZone": "UTC",
	}
	result, commandError := s.router.Execute(
		r.Context(), protocol.MethodSessionPrompt, request.DeviceID, request.RequestID, params,
		time.Duration(request.TimeoutMS)*time.Millisecond,
	)
	s.auditMobileSession(actor, r, "mobile.session.prompt", request.DeviceID, sessionID, request.RequestID, commandError)
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
	s.auditMobileSession(actor, r, "mobile.session.cancel", request.DeviceID, sessionID, request.RequestID, commandError)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	writeRawJSON(w, http.StatusOK, result)
}

// authorizeMobileSession verifies the user's effective policy for the desktop,
// workspace and required scope. The Connector independently validates the
// session's real workspace ownership and Router rechecks desktop grants.
func (s *Server) authorizeMobileSession(r *http.Request, deviceID, workspaceID, sessionID, scope string) (mobileActor, *protocol.Error) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		return mobileActor{}, errorPtr(protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
	}
	_ = sessionID
	accessible, err := s.mobileUserDesktops(r.Context(), actor.User.ID)
	if err != nil {
		return actor, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not resolve user desktop access", true))
	}
	for _, desktop := range accessible {
		if desktop.device.DeviceID != deviceID {
			continue
		}
		for _, workspace := range desktop.workspaces {
			if workspace.summary.ID == workspaceID && hasScope(workspace.scopes, scope) {
				return actor, nil
			}
		}
	}
	return actor, errorPtr(protocol.NewError(protocol.CodeForbidden, "the user access policy does not include this desktop, workspace, and action", false))
}

func (s *Server) auditMobileSession(actor mobileActor, r *http.Request, action, deviceID, sessionID, requestID string, commandError *protocol.Error) {
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
		RequestID:  requestID,
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
	case protocol.ConnectorMethodPairUpdateGrants:
		return s.connectorUpdateGrants(ctx, connection.deviceID, request.Params)
	case protocol.ConnectorMethodInteractionAudience:
		return s.connectorInteractionAudience(ctx, connection.deviceID, request.Params)
	default:
		return nil, errorPtr(protocol.NewError(protocol.CodeMethodNotSupported, "unsupported Connector request method", false))
	}
}

// connectorUpdateGrants lets the desktop explicitly widen or narrow its own
// authorized workspaces and scopes without re-pairing. User-policy permissions
// are intersected with these current grants, so narrowing takes effect immediately.
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

// ---------- small helpers ----------

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
