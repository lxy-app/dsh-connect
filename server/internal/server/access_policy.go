package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

type accessPolicyListResponse struct {
	Policies []store.AccessPolicyRecord `json:"policies"`
}

type createAccessPolicyRequest struct {
	Name        string                   `json:"name"`
	Description string                   `json:"description"`
	Enabled     *bool                    `json:"enabled"`
	MemberIDs   []string                 `json:"memberIds"`
	Rules       []store.AccessPolicyRule `json:"rules"`
}

type updateAccessPolicyRequest struct {
	Name        *string                   `json:"name"`
	Description *string                   `json:"description"`
	Enabled     *bool                     `json:"enabled"`
	MemberIDs   *[]string                 `json:"memberIds"`
	Rules       *[]store.AccessPolicyRule `json:"rules"`
	Revision    int64                     `json:"revision"`
}

func (s *Server) handleAdminAccessPolicies(w http.ResponseWriter, r *http.Request) {
	policies, err := s.store.AccessPolicies(r.Context())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load access policies", true))
		return
	}
	for index := range policies {
		policies[index] = normalizeAccessPolicyRecord(policies[index])
	}
	writeJSON(w, http.StatusOK, accessPolicyListResponse{Policies: policies})
}

func (s *Server) handleAdminCreateAccessPolicy(w http.ResponseWriter, r *http.Request) {
	var request createAccessPolicyRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if !validText(request.Name, 128) || !validAccessPolicyDescription(request.Description) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "name is required and description must be valid text", false))
		return
	}
	memberIDs, commandError := s.validateAccessPolicyMembers(r.Context(), request.MemberIDs)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	rules, commandError := s.validateAccessPolicyRules(r.Context(), request.Rules)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	policyID, err := randomToken("ap_")
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate access policy identity", true))
		return
	}
	enabled := true
	if request.Enabled != nil {
		enabled = *request.Enabled
	}
	now := nowUTC()
	created, err := s.store.CreateAccessPolicy(r.Context(), store.AccessPolicyRecord{
		PolicyID:    policyID,
		Name:        request.Name,
		Description: request.Description,
		Enabled:     enabled,
		MemberIDs:   memberIDs,
		Rules:       rules,
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	if err != nil {
		writeAccessPolicyStoreError(w, err, "create")
		return
	}
	s.recordAccessPolicyAudit(r, "admin.policy.create", nil, &created)
	writeJSON(w, http.StatusCreated, normalizeAccessPolicyRecord(created))
}

func (s *Server) handleAdminUpdateAccessPolicy(w http.ResponseWriter, r *http.Request) {
	policyID := r.PathValue("policyId")
	if !validID(policyID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid policyId required", false))
		return
	}
	var request updateAccessPolicyRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if request.Revision < 1 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "a positive revision is required", false))
		return
	}
	if request.Name != nil && !validText(*request.Name, 128) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "name must be valid non-empty text", false))
		return
	}
	if request.Description != nil && !validAccessPolicyDescription(*request.Description) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "description must be valid text", false))
		return
	}
	if request.MemberIDs != nil {
		memberIDs, commandError := s.validateAccessPolicyMembers(r.Context(), *request.MemberIDs)
		if commandError != nil {
			writeAPIError(w, *commandError)
			return
		}
		request.MemberIDs = &memberIDs
	}
	if request.Rules != nil {
		rules, commandError := s.validateAccessPolicyRules(r.Context(), *request.Rules)
		if commandError != nil {
			writeAPIError(w, *commandError)
			return
		}
		request.Rules = &rules
	}
	before, err := s.accessPolicyByID(r.Context(), policyID)
	if err != nil {
		writeAccessPolicyStoreError(w, err, "load")
		return
	}
	updated, err := s.store.UpdateAccessPolicy(r.Context(), policyID, request.Revision, store.AccessPolicyUpdate{
		Name:        request.Name,
		Description: request.Description,
		Enabled:     request.Enabled,
		MemberIDs:   request.MemberIDs,
		Rules:       request.Rules,
	})
	if err != nil {
		writeAccessPolicyStoreError(w, err, "update")
		return
	}
	if request.Enabled != nil || request.MemberIDs != nil || request.Rules != nil {
		s.closeAccessPolicyStreams(before, updated)
	}
	s.recordAccessPolicyAudit(r, "admin.policy.update", &before, &updated)
	writeJSON(w, http.StatusOK, normalizeAccessPolicyRecord(updated))
}

func (s *Server) handleAdminDeleteAccessPolicy(w http.ResponseWriter, r *http.Request) {
	policyID := r.PathValue("policyId")
	if !validID(policyID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid policyId required", false))
		return
	}
	revision, err := strconv.ParseInt(r.URL.Query().Get("revision"), 10, 64)
	if err != nil || revision < 1 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "a positive revision query parameter is required", false))
		return
	}
	before, err := s.accessPolicyByID(r.Context(), policyID)
	if err != nil {
		writeAccessPolicyStoreError(w, err, "load")
		return
	}
	if err := s.store.DeleteAccessPolicy(r.Context(), policyID, revision); err != nil {
		writeAccessPolicyStoreError(w, err, "delete")
		return
	}
	s.closeAccessPolicyStreams(before)
	s.recordAccessPolicyAudit(r, "admin.policy.delete", &before, nil)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) recordAccessPolicyAudit(r *http.Request, action string, before, after *store.AccessPolicyRecord) {
	entry := store.AuditEntry{
		OccurredAt: nowUTC(),
		Actor:      auditActor(r),
		Action:     action,
		Result:     "success",
		SourceIP:   sourceIP(r),
	}
	details := struct {
		Before *store.AccessPolicyRecord `json:"before,omitempty"`
		After  *store.AccessPolicyRecord `json:"after,omitempty"`
	}{}
	if before != nil {
		snapshot := normalizeAccessPolicyRecord(*before)
		details.Before = &snapshot
	}
	if after != nil {
		snapshot := normalizeAccessPolicyRecord(*after)
		details.After = &snapshot
	}
	if encoded, err := json.Marshal(details); err == nil {
		entry.Details = encoded
	}
	s.audit(entry)
}

func normalizeAccessPolicyRecord(record store.AccessPolicyRecord) store.AccessPolicyRecord {
	if record.MemberIDs == nil {
		record.MemberIDs = []string{}
	}
	if record.Rules == nil {
		record.Rules = []store.AccessPolicyRule{}
	}
	for index := range record.Rules {
		if record.Rules[index].WorkspaceIDs == nil {
			record.Rules[index].WorkspaceIDs = []string{}
		}
		if record.Rules[index].Scopes == nil {
			record.Rules[index].Scopes = []string{}
		}
	}
	return record
}

func (s *Server) accessPolicyByID(ctx context.Context, policyID string) (store.AccessPolicyRecord, error) {
	policies, err := s.store.AccessPolicies(ctx)
	if err != nil {
		return store.AccessPolicyRecord{}, err
	}
	for _, policy := range policies {
		if policy.PolicyID == policyID {
			return policy, nil
		}
	}
	return store.AccessPolicyRecord{}, store.ErrAccessPolicyNotFound
}

func (s *Server) closeAccessPolicyStreams(policies ...store.AccessPolicyRecord) {
	userIDs := make(map[string]struct{})
	for _, policy := range policies {
		for _, userID := range policy.MemberIDs {
			userIDs[userID] = struct{}{}
		}
	}
	for userID := range userIDs {
		s.events.CloseUser(userID)
	}
}

func writeAccessPolicyStoreError(w http.ResponseWriter, err error, operation string) {
	switch {
	case errors.Is(err, store.ErrAccessPolicyNotFound):
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "access policy not found", false))
	case errors.Is(err, store.ErrAccessPolicyConflict):
		writeAPIError(w, protocol.NewError(protocol.CodeConflict, "access policy revision conflict", false))
	case errors.Is(err, store.ErrAccessPolicyNameTaken):
		writeAPIError(w, protocol.NewError(protocol.CodeConflict, "access policy name is already registered", false))
	default:
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not "+operation+" access policy", true))
	}
}

func validAccessPolicyDescription(value string) bool {
	return len(value) <= 1024 && !strings.ContainsAny(value, "\x00\r\n")
}

func (s *Server) validateAccessPolicyMembers(ctx context.Context, memberIDs []string) ([]string, *protocol.Error) {
	result := make([]string, 0, len(memberIDs))
	seen := make(map[string]struct{}, len(memberIDs))
	for _, userID := range memberIDs {
		if !validID(userID) {
			return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "invalid member user id", false))
		}
		if _, duplicate := seen[userID]; duplicate {
			continue
		}
		if _, err := s.store.UserByID(ctx, userID); err != nil {
			if errors.Is(err, store.ErrUserNotFound) {
				return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "member user does not exist", false))
			}
			return nil, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not validate access policy members", true))
		}
		seen[userID] = struct{}{}
		result = append(result, userID)
	}
	return result, nil
}

func (s *Server) validateAccessPolicyRules(ctx context.Context, rules []store.AccessPolicyRule) ([]store.AccessPolicyRule, *protocol.Error) {
	result := make([]store.AccessPolicyRule, 0, len(rules))
	devices := make(map[string]struct{}, len(rules))
	for _, rule := range rules {
		if !validID(rule.DeviceID) || len(rule.WorkspaceIDs) == 0 || len(rule.Scopes) == 0 {
			return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "each rule requires a device, workspaces and scopes", false))
		}
		if _, duplicate := devices[rule.DeviceID]; duplicate {
			return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "each device may appear in only one rule", false))
		}
		device, err := s.store.Device(ctx, rule.DeviceID)
		if errors.Is(err, store.ErrDeviceNotFound) {
			return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "rule desktop device does not exist", false))
		}
		if err != nil {
			return nil, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not validate access policy desktop", true))
		}
		availableWorkspaces := make(map[string]struct{}, len(device.Device.Workspaces))
		for _, workspace := range device.Device.Workspaces {
			availableWorkspaces[workspace.ID] = struct{}{}
		}
		availableScopes := make(map[string]struct{}, len(device.Device.Scopes))
		for _, scope := range device.Device.Scopes {
			availableScopes[scope] = struct{}{}
		}
		normalized := store.AccessPolicyRule{
			DeviceID:     rule.DeviceID,
			WorkspaceIDs: make([]string, 0, len(rule.WorkspaceIDs)),
			Scopes:       make([]string, 0, len(rule.Scopes)),
		}
		workspaceSet := make(map[string]struct{}, len(rule.WorkspaceIDs))
		for _, workspaceID := range rule.WorkspaceIDs {
			if !validID(workspaceID) {
				return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "invalid rule workspace id", false))
			}
			if _, allowed := availableWorkspaces[workspaceID]; !allowed {
				return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "rule workspace is not authorized on this desktop", false))
			}
			if _, duplicate := workspaceSet[workspaceID]; duplicate {
				continue
			}
			workspaceSet[workspaceID] = struct{}{}
			normalized.WorkspaceIDs = append(normalized.WorkspaceIDs, workspaceID)
		}
		scopeSet := make(map[string]struct{}, len(rule.Scopes))
		for _, scope := range rule.Scopes {
			if !hasScope(canonicalScopes, scope) {
				return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "unsupported rule scope", false))
			}
			if _, allowed := availableScopes[scope]; !allowed {
				return nil, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "rule scope is not authorized on this desktop", false))
			}
			if _, duplicate := scopeSet[scope]; duplicate {
				continue
			}
			scopeSet[scope] = struct{}{}
			normalized.Scopes = append(normalized.Scopes, scope)
		}
		normalized.Scopes = orderScopes(normalized.Scopes)
		devices[rule.DeviceID] = struct{}{}
		result = append(result, normalized)
	}
	return result, nil
}

// policyAccess is the immutable, per-request projection of all enabled policies
// assigned to one user. Missing devices, workspaces and scopes are denied.
type policyAccess struct {
	policyIDs []string
	byDevice  map[string]map[string]map[string]struct{}
}

func (s *Server) policyAccessForUser(ctx context.Context, userID string) (policyAccess, error) {
	policies, err := s.store.AccessPolicies(ctx)
	if err != nil {
		return policyAccess{}, err
	}
	access := policyAccess{
		policyIDs: make([]string, 0),
		byDevice:  make(map[string]map[string]map[string]struct{}),
	}
	for _, policy := range policies {
		if !policy.Enabled || !hasScope(policy.MemberIDs, userID) {
			continue
		}
		access.policyIDs = append(access.policyIDs, policy.PolicyID)
		for _, rule := range policy.Rules {
			workspaces := access.byDevice[rule.DeviceID]
			if workspaces == nil {
				workspaces = make(map[string]map[string]struct{})
				access.byDevice[rule.DeviceID] = workspaces
			}
			for _, workspaceID := range rule.WorkspaceIDs {
				scopes := workspaces[workspaceID]
				if scopes == nil {
					scopes = make(map[string]struct{})
					workspaces[workspaceID] = scopes
				}
				for _, scope := range rule.Scopes {
					scopes[scope] = struct{}{}
				}
			}
		}
	}
	sort.Strings(access.policyIDs)
	return access, nil
}

func (p policyAccess) allows(deviceID, workspaceID, scope string) bool {
	workspaces := p.byDevice[deviceID]
	if workspaces == nil {
		return false
	}
	scopes := workspaces[workspaceID]
	if scopes == nil {
		return false
	}
	_, allowed := scopes[scope]
	return allowed
}

func (p policyAccess) allowsRequest(deviceID string, workspaces, scopes []string) bool {
	if len(workspaces) == 0 || len(scopes) == 0 {
		return false
	}
	for _, workspaceID := range workspaces {
		for _, scope := range scopes {
			if !p.allows(deviceID, workspaceID, scope) {
				return false
			}
		}
	}
	return true
}

func (p policyAccess) scopes(deviceID, workspaceID string) []string {
	workspaces := p.byDevice[deviceID]
	if workspaces == nil {
		return []string{}
	}
	return orderScopes(setKeys(workspaces[workspaceID]))
}

func (p policyAccess) workspaceScopes(deviceID string) map[string]map[string]struct{} {
	return p.byDevice[deviceID]
}

func setKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	return result
}

type accessPreviewResponse struct {
	UserID    string                 `json:"userId"`
	PolicyIDs []string               `json:"policyIds"`
	Desktops  []accessPreviewDesktop `json:"desktops"`
}

type accessPreviewDesktop struct {
	DeviceID   string                   `json:"deviceId"`
	DeviceName string                   `json:"deviceName"`
	Online     bool                     `json:"online"`
	Workspaces []accessPreviewWorkspace `json:"workspaces"`
	Scopes     []string                 `json:"scopes"`
}

type accessPreviewWorkspace struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Scopes []string `json:"scopes"`
}

func (s *Server) handleAdminAccessPreview(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userId")
	if !validID(userID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid userId required", false))
		return
	}
	if _, err := s.store.UserByID(r.Context(), userID); err != nil {
		if errors.Is(err, store.ErrUserNotFound) {
			writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "user not found", false))
			return
		}
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load user", true))
		return
	}
	access, err := s.policyAccessForUser(r.Context(), userID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not resolve user access policy", true))
		return
	}
	devices, err := s.store.Devices(r.Context())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load desktop devices", true))
		return
	}
	response := accessPreviewResponse{
		UserID:    userID,
		PolicyIDs: append([]string{}, access.policyIDs...),
		Desktops:  make([]accessPreviewDesktop, 0),
	}
	for _, record := range devices {
		device := record.Device
		if device.Status == "revoked" || device.Status == "waiting_desktop_authorization" {
			continue
		}
		allowedWorkspaces := access.workspaceScopes(device.DeviceID)
		if len(allowedWorkspaces) == 0 {
			continue
		}
		desktop := accessPreviewDesktop{
			DeviceID:   device.DeviceID,
			DeviceName: device.DeviceName,
			Online:     s.hub.Get(device.DeviceID) != nil,
			Workspaces: make([]accessPreviewWorkspace, 0, len(allowedWorkspaces)),
			Scopes:     make([]string, 0),
		}
		deviceScopes := make(map[string]struct{}, len(device.Scopes))
		for _, scope := range device.Scopes {
			deviceScopes[scope] = struct{}{}
		}
		desktopScopes := make(map[string]struct{})
		for _, workspace := range mobileWorkspaceSummaries(device.Workspaces) {
			allowedScopes, allowed := allowedWorkspaces[workspace.ID]
			if !allowed {
				continue
			}
			effectiveScopes := make(map[string]struct{})
			for scope := range allowedScopes {
				if _, available := deviceScopes[scope]; available {
					effectiveScopes[scope] = struct{}{}
					desktopScopes[scope] = struct{}{}
				}
			}
			desktop.Workspaces = append(desktop.Workspaces, accessPreviewWorkspace{
				ID: workspace.ID, Name: workspace.Name, Scopes: orderScopes(setKeys(effectiveScopes)),
			})
		}
		desktop.Scopes = orderScopes(setKeys(desktopScopes))
		response.Desktops = append(response.Desktops, desktop)
	}
	writeJSON(w, http.StatusOK, response)
}
