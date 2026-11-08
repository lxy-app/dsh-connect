package server

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

func (s *Server) adminRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/admin/auth/login", s.handleAdminLogin)
	mux.HandleFunc("POST /v1/admin/auth/logout", s.adminAuth(s.handleAdminLogout))
	mux.HandleFunc("GET /v1/admin/auth/me", s.adminAuth(s.handleAdminMe))

	mux.HandleFunc("GET /v1/admin/overview", s.requireRole(store.RoleOwner, store.RoleAdmin, store.RoleAuditor)(s.handleAdminOverview))

	mux.HandleFunc("GET /v1/admin/users", s.requireRole(store.RoleOwner, store.RoleAdmin, store.RoleAuditor)(s.handleAdminUsers))
	mux.HandleFunc("POST /v1/admin/users", s.requireRole(store.RoleOwner, store.RoleAdmin)(s.handleAdminCreateUser))
	mux.HandleFunc("PATCH /v1/admin/users/{userId}", s.requireRole(store.RoleOwner, store.RoleAdmin)(s.handleAdminUpdateUser))
	mux.HandleFunc("DELETE /v1/admin/users/{userId}", s.requireRole(store.RoleOwner)(s.handleAdminDeleteUser))
	mux.HandleFunc("GET /v1/admin/users/{userId}/access-preview", s.requireRole(store.RoleOwner, store.RoleAdmin, store.RoleAuditor)(s.handleAdminAccessPreview))

	mux.HandleFunc("GET /v1/admin/policies", s.requireRole(store.RoleOwner, store.RoleAdmin, store.RoleAuditor)(s.handleAdminAccessPolicies))
	mux.HandleFunc("POST /v1/admin/policies", s.requireRole(store.RoleOwner, store.RoleAdmin)(s.handleAdminCreateAccessPolicy))
	mux.HandleFunc("PATCH /v1/admin/policies/{policyId}", s.requireRole(store.RoleOwner, store.RoleAdmin)(s.handleAdminUpdateAccessPolicy))
	mux.HandleFunc("DELETE /v1/admin/policies/{policyId}", s.requireRole(store.RoleOwner, store.RoleAdmin)(s.handleAdminDeleteAccessPolicy))

	mux.HandleFunc("GET /v1/admin/devices", s.requireRole(store.RoleOwner, store.RoleAdmin, store.RoleAuditor)(s.handleAdminDevices))
	mux.HandleFunc("PATCH /v1/admin/devices/{deviceId}", s.requireRole(store.RoleOwner, store.RoleAdmin)(s.handleAdminUpdateDevice))
	mux.HandleFunc("DELETE /v1/admin/devices/{deviceId}", s.requireRole(store.RoleOwner, store.RoleAdmin)(s.handleAdminDeleteDevice))
	mux.HandleFunc("POST /v1/admin/devices/{deviceId}/revoke", s.requireRole(store.RoleOwner, store.RoleAdmin)(s.handleAdminRevokeDevice))

	mux.HandleFunc("GET /v1/admin/audit", s.requireRole(store.RoleOwner, store.RoleAdmin, store.RoleAuditor)(s.handleAdminAudit))

	// Pairing codes are how a new desktop joins, so the Web Admin needs its own
	// entry point: /v1/pairing/desktop-codes only accepts the bootstrap token.
	mux.HandleFunc("POST /v1/admin/pairing-codes", s.requireRole(store.RoleOwner, store.RoleAdmin)(s.handleAdminCreatePairingCode))
	mux.HandleFunc("GET /v1/admin/pairing-codes", s.requireRole(store.RoleOwner, store.RoleAdmin, store.RoleAuditor)(s.handleAdminListPairingCodes))
}

// ---------- auth ----------

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token     string     `json:"token"`
	ExpiresAt time.Time  `json:"expiresAt"`
	User      store.User `json:"user"`
}

func (s *Server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	var request loginRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if request.Email == "" || request.Password == "" {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "email and password are required", false))
		return
	}
	user, err := s.store.UserByEmail(r.Context(), request.Email)
	if err != nil || !store.CheckPassword(user.PasswordHash, request.Password) {
		// Same response for unknown email and wrong password.
		s.audit(store.AuditEntry{
			OccurredAt: nowUTC(),
			Actor:      "anonymous:" + store.NormalizeEmail(request.Email),
			Action:     "admin.login",
			Result:     "error",
			ErrorCode:  "unauthorized",
			SourceIP:   sourceIP(r),
		})
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "invalid email or password", false))
		return
	}
	if user.Status != store.UserStatusActive {
		s.audit(store.AuditEntry{
			OccurredAt: nowUTC(),
			Actor:      "user:" + user.ID,
			Action:     "admin.login",
			Result:     "error",
			ErrorCode:  "forbidden",
			SourceIP:   sourceIP(r),
		})
		writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "account is disabled", false))
		return
	}
	token, err := randomToken("adm_")
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate session token", true))
		return
	}
	sessionID, err := randomToken("ses_")
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate session identity", true))
		return
	}
	if _, err := s.store.CreateAdminSession(
		r.Context(), token, sessionID, user.ID, s.sessionTTL(), sourceIP(r), r.UserAgent(),
	); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not persist session", true))
		return
	}
	// Login happens before a session exists, so the actor is recorded explicitly
	// instead of being read from the (absent) request context.
	s.audit(store.AuditEntry{
		OccurredAt: nowUTC(),
		Actor:      "user:" + user.ID,
		Action:     "admin.login",
		Result:     "success",
		SourceIP:   sourceIP(r),
	})
	user.PasswordHash = ""
	writeJSON(w, http.StatusOK, loginResponse{
		Token:     token,
		ExpiresAt: nowUTC().Add(s.sessionTTL()),
		User:      user,
	})
}

func (s *Server) handleAdminLogout(w http.ResponseWriter, r *http.Request) {
	token, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "bearer token required", false))
		return
	}
	if err := s.store.RevokeAdminSession(r.Context(), token); err != nil && !errors.Is(err, store.ErrSessionInvalid) {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not revoke session", true))
		return
	}
	s.recordAdminAudit(r, "admin.logout", "success", "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAdminMe(w http.ResponseWriter, r *http.Request) {
	actor, _ := adminFromContext(r.Context())
	actor.User.PasswordHash = ""
	writeJSON(w, http.StatusOK, actor.User)
}

// ---------- overview ----------

type overviewResponse struct {
	Devices map[string]int     `json:"devices"`
	Users   map[string]int     `json:"users"`
	Audit   int                `json:"auditEntries"`
	Recent  []store.AuditEntry `json:"recentActivity"`
}

func (s *Server) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	devices, err := s.store.Devices(r.Context())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load devices", true))
		return
	}
	deviceCounts := map[string]int{"total": len(devices), "online": 0, "offline": 0, "waiting": 0, "revoked": 0}
	for _, record := range devices {
		switch record.Device.Status {
		case "online":
			deviceCounts["online"]++
		case "offline":
			deviceCounts["offline"]++
		case "waiting_desktop_authorization":
			deviceCounts["waiting"]++
		case "revoked":
			deviceCounts["revoked"]++
		}
	}

	users, err := s.store.Users(r.Context())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load users", true))
		return
	}
	userCounts := map[string]int{"total": len(users), "active": 0, "disabled": 0}
	for _, user := range users {
		if user.Status == store.UserStatusActive {
			userCounts["active"]++
		} else {
			userCounts["disabled"]++
		}
	}

	recent, total, err := s.store.Audit(r.Context(), store.AuditQuery{Limit: 8})
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load audit entries", true))
		return
	}
	if recent == nil {
		recent = []store.AuditEntry{}
	}
	writeJSON(w, http.StatusOK, overviewResponse{
		Devices: deviceCounts,
		Users:   userCounts,
		Audit:   total,
		Recent:  recent,
	})
}

// ---------- users ----------

type userListResponse struct {
	Users []store.User `json:"users"`
}

type createUserRequest struct {
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
	Role        string `json:"role"`
}

func validRole(role string) bool {
	switch role {
	case store.RoleOwner, store.RoleAdmin, store.RoleMember, store.RoleAuditor:
		return true
	default:
		return false
	}
}

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.Users(r.Context())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load users", true))
		return
	}
	writeJSON(w, http.StatusOK, userListResponse{Users: users})
}

func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	var request createUserRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	request.Email = store.NormalizeEmail(request.Email)
	if !validEmail(request.Email) || !validText(request.DisplayName, 128) || len(request.Password) < 8 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "email, displayName and a password of at least 8 characters are required", false))
		return
	}
	if request.Role == "" {
		request.Role = store.RoleMember
	}
	if !validRole(request.Role) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "unknown role", false))
		return
	}
	actor, _ := adminFromContext(r.Context())
	if request.Role == store.RoleOwner && actor.User.Role != store.RoleOwner {
		writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "only an owner can create another owner", false))
		return
	}
	userID, err := randomToken("usr_")
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate user identity", true))
		return
	}
	user, err := s.store.CreateUser(r.Context(), userID, request.Email, request.DisplayName, request.Password, request.Role)
	if errors.Is(err, store.ErrUserEmailTaken) {
		writeAPIError(w, protocol.NewError(protocol.CodeConflict, "email is already registered", false))
		return
	}
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not create user", true))
		return
	}
	s.recordAdminAudit(r, "admin.user.create", "success", "")
	writeJSON(w, http.StatusCreated, user)
}

type updateUserRequest struct {
	DisplayName *string `json:"displayName"`
	Role        *string `json:"role"`
	Status      *string `json:"status"`
	Password    *string `json:"password"`
}

func (s *Server) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userId")
	if !validID(userID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid userId required", false))
		return
	}
	var request updateUserRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	actor, _ := adminFromContext(r.Context())
	actorIsOwner := actor.User.Role == store.RoleOwner

	if request.Role != nil {
		if !validRole(*request.Role) {
			writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "unknown role", false))
			return
		}
		if !actorIsOwner {
			writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "only an owner can change roles", false))
			return
		}
	}
	if request.Status != nil {
		if *request.Status != store.UserStatusActive && *request.Status != store.UserStatusDisabled {
			writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "status must be active or disabled", false))
			return
		}
		if !actorIsOwner {
			writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "only an owner can change account status", false))
			return
		}
	}
	if request.Password != nil && len(*request.Password) < 8 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "password must be at least 8 characters", false))
		return
	}
	if request.DisplayName != nil && !validText(*request.DisplayName, 128) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "displayName is required", false))
		return
	}

	target, err := s.store.UserByID(r.Context(), userID)
	if errors.Is(err, store.ErrUserNotFound) {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "user not found", false))
		return
	}
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load user", true))
		return
	}
	// Administrators may maintain non-owner accounts, but only an owner may alter
	// an owner's profile or credentials. The UI hides this action as well; this
	// server-side check is the security boundary against password-reset escalation.
	if !actorIsOwner && target.Role == store.RoleOwner {
		writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "only an owner can update an owner", false))
		return
	}
	update := store.UserUpdate{
		DisplayName: request.DisplayName,
		Role:        request.Role,
		Status:      request.Status,
		Password:    request.Password,
	}
	var updated store.User
	if actorIsOwner {
		updated, err = s.store.UpdateUser(r.Context(), userID, update)
	} else {
		updated, err = s.store.UpdateUserExcludingOwner(r.Context(), userID, update)
	}
	if errors.Is(err, store.ErrOwnerUpdateForbidden) {
		writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "only an owner can update an owner", false))
		return
	}
	if errors.Is(err, store.ErrUserNotFound) {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "user not found", false))
		return
	}
	if errors.Is(err, store.ErrLastActiveOwner) {
		writeAPIError(w, protocol.NewError(protocol.CodeConflict, "the last active owner cannot be demoted or disabled", false))
		return
	}
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not update user", true))
		return
	}
	if request.Status != nil && *request.Status == store.UserStatusDisabled {
		s.events.CloseUser(userID)
	}
	s.recordAdminAudit(r, "admin.user.update", "success", "")
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userId")
	if !validID(userID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid userId required", false))
		return
	}
	if err := s.store.DeleteUser(r.Context(), userID); err != nil {
		if errors.Is(err, store.ErrUserNotFound) {
			writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "user not found", false))
			return
		}
		if errors.Is(err, store.ErrLastActiveOwner) {
			writeAPIError(w, protocol.NewError(protocol.CodeConflict, "the last active owner cannot be deleted", false))
			return
		}
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not delete user", true))
		return
	}
	s.events.CloseUser(userID)
	s.recordAdminAudit(r, "admin.user.delete", "success", "")
	w.WriteHeader(http.StatusNoContent)
}

// ---------- devices ----------

type adminDevice struct {
	protocol.Device
	HasToken bool `json:"hasToken"`
}

type adminDeviceListResponse struct {
	Devices []adminDevice `json:"devices"`
}

func (s *Server) handleAdminDevices(w http.ResponseWriter, r *http.Request) {
	records, err := s.store.Devices(r.Context())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load devices", true))
		return
	}
	devices := make([]adminDevice, 0, len(records))
	for _, record := range records {
		devices = append(devices, adminDevice{Device: record.Device, HasToken: record.DeviceTokenHash != ""})
	}
	writeJSON(w, http.StatusOK, adminDeviceListResponse{Devices: devices})
}

type updateDeviceRequest struct {
	DeviceName *string `json:"deviceName"`
}

func (s *Server) handleAdminUpdateDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("deviceId")
	if !validID(deviceID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid deviceId required", false))
		return
	}
	var request updateDeviceRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if request.DeviceName == nil || !validText(*request.DeviceName, 256) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "deviceName is required", false))
		return
	}
	if err := s.store.RenameDevice(r.Context(), deviceID, *request.DeviceName, nowUTC()); err != nil {
		if errors.Is(err, store.ErrDeviceNotFound) {
			writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "device not found", false))
			return
		}
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not update device", true))
		return
	}
	s.recordAdminAudit(r, "admin.device.update", "success", "")
	record, err := s.store.Device(r.Context(), deviceID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not reload device", true))
		return
	}
	writeJSON(w, http.StatusOK, adminDevice{Device: record.Device, HasToken: record.DeviceTokenHash != ""})
}

// handleAdminRevokeDevice invalidates a device credential and disconnects it.
func (s *Server) handleAdminRevokeDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("deviceId")
	if !validID(deviceID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid deviceId required", false))
		return
	}
	if err := s.store.RevokeDevice(r.Context(), deviceID, nowUTC()); err != nil {
		if errors.Is(err, store.ErrDeviceNotFound) {
			writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "device not found", false))
			return
		}
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not revoke device", true))
		return
	}
	if connection := s.hub.Get(deviceID); connection != nil {
		connection.shutdown("device revoked by administrator")
	}
	if err := s.store.RevokeMobileAccessGrantsForDevice(r.Context(), deviceID, nowUTC()); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not revoke mobile access grants", true))
		return
	}
	s.events.CloseDevice(deviceID)
	s.recordAdminAudit(r, "admin.device.revoke", "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (s *Server) handleAdminDeleteDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("deviceId")
	if !validID(deviceID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid deviceId required", false))
		return
	}
	if connection := s.hub.Get(deviceID); connection != nil {
		connection.shutdown("device deleted by administrator")
	}
	if err := s.store.RevokeMobileAccessGrantsForDevice(r.Context(), deviceID, nowUTC()); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not revoke mobile access grants", true))
		return
	}
	if err := s.store.DeleteDevice(r.Context(), deviceID); err != nil {
		if errors.Is(err, store.ErrDeviceNotFound) {
			writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "device not found", false))
			return
		}
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not delete device", true))
		return
	}
	s.events.CloseDevice(deviceID)
	s.recordAdminAudit(r, "admin.device.delete", "success", "")
	w.WriteHeader(http.StatusNoContent)
}

// ---------- audit ----------

type auditListResponse struct {
	Entries []store.AuditEntry `json:"entries"`
	Total   int                `json:"total"`
	Limit   int                `json:"limit"`
	Offset  int                `json:"offset"`
}

func (s *Server) handleAdminAudit(w http.ResponseWriter, r *http.Request) {
	query := store.AuditQuery{
		Actor:    r.URL.Query().Get("actor"),
		Action:   r.URL.Query().Get("action"),
		DeviceID: r.URL.Query().Get("deviceId"),
		Result:   r.URL.Query().Get("result"),
	}
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 500 {
			writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "limit must be between 1 and 500", false))
			return
		}
		limit = parsed
	}
	offset := 0
	if raw := r.URL.Query().Get("offset"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "offset must be a non-negative integer", false))
			return
		}
		offset = parsed
	}
	query.Limit = limit
	query.Offset = offset
	if raw := r.URL.Query().Get("from"); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "from must be RFC3339", false))
			return
		}
		query.From = &parsed
	}
	if raw := r.URL.Query().Get("to"); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "to must be RFC3339", false))
			return
		}
		query.To = &parsed
	}

	entries, total, err := s.store.Audit(r.Context(), query)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load audit entries", true))
		return
	}
	if entries == nil {
		entries = []store.AuditEntry{}
	}
	writeJSON(w, http.StatusOK, auditListResponse{
		Entries: entries,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
	})
}

// ---------- pairing codes ----------

type createPairingCodeResponse struct {
	PairingID int       `json:"pairingId"`
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
	ServerURL string    `json:"serverUrl"`
}

// handleAdminCreatePairingCode issues a desktop pairing code from the Web Admin.
// The plaintext code is returned exactly once; only its hash is persisted.
func (s *Server) handleAdminCreatePairingCode(w http.ResponseWriter, r *http.Request) {
	_, response, commandError := s.issuePairingCode(r)
	if commandError != nil {
		s.recordAdminAudit(r, "admin.pairing_code.create", "error", commandError.Code)
		writeAPIError(w, *commandError)
		return
	}
	s.recordAdminAudit(r, "admin.pairing_code.create", "success", "")
	writeJSON(w, http.StatusCreated, response)
}

// issuePairingCode generates and persists a one-time code. Shared by the
// bootstrap-token endpoint and the Web Admin endpoint so both behave identically.
func (s *Server) issuePairingCode(r *http.Request) (string, createPairingCodeResponse, *protocol.Error) {
	code, err := randomPairingCode()
	if err != nil {
		return "", createPairingCodeResponse{}, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not generate pairing code", true))
	}
	now := nowUTC()
	expiresAt := now.Add(s.config.PairingCodeTTL)
	pairingID, err := s.store.CreatePairingCode(r.Context(), store.PairingCode{
		CodeHash:  store.HashToken(code),
		CreatedAt: now,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return "", createPairingCodeResponse{}, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not persist pairing code", true))
	}
	return code, createPairingCodeResponse{
		PairingID: pairingID,
		Code:      code,
		ExpiresAt: expiresAt,
		ServerURL: s.config.ServerURL,
	}, nil
}

type pairingCodeView struct {
	PairingID int        `json:"pairingId"`
	State     string     `json:"state"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	UsedAt    *time.Time `json:"usedAt,omitempty"`
	DeviceID  string     `json:"deviceId,omitempty"`
}

type pairingCodeListResponse struct {
	Codes []pairingCodeView `json:"codes"`
}

// handleAdminListPairingCodes reports recent pairing code state. Codes are never
// echoed back: only their lifecycle metadata is available.
func (s *Server) handleAdminListPairingCodes(w http.ResponseWriter, r *http.Request) {
	records, err := s.store.PairingCodes(r.Context(), 20)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load pairing codes", true))
		return
	}
	now := nowUTC()
	codes := make([]pairingCodeView, 0, len(records))
	for _, record := range records {
		state := "active"
		switch {
		case record.UsedAt != nil:
			state = "used"
			if record.DeviceID != "" {
				deviceRecord, err := s.store.Device(r.Context(), record.DeviceID)
				if err != nil && !errors.Is(err, store.ErrDeviceNotFound) {
					writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load pairing device state", true))
					return
				}
				if err == nil && deviceRecord.Device.Status == "waiting_desktop_authorization" {
					state = "waiting_desktop_authorization"
				}
			}
		case !now.Before(record.ExpiresAt):
			state = "expired"
		}
		codes = append(codes, pairingCodeView{
			PairingID: record.ID,
			State:     state,
			CreatedAt: record.CreatedAt,
			ExpiresAt: record.ExpiresAt,
			UsedAt:    record.UsedAt,
			DeviceID:  record.DeviceID,
		})
	}
	writeJSON(w, http.StatusOK, pairingCodeListResponse{Codes: codes})
}

// ---------- helpers ----------

func (s *Server) recordAdminAudit(r *http.Request, action, result, errorCode string) {
	s.audit(store.AuditEntry{
		OccurredAt: nowUTC(),
		Actor:      auditActor(r),
		Action:     action,
		Result:     result,
		ErrorCode:  errorCode,
		SourceIP:   sourceIP(r),
	})
}

func validEmail(email string) bool {
	if email == "" || len(email) > 254 {
		return false
	}
	at := strings.Index(email, "@")
	if at <= 0 || at == len(email)-1 {
		return false
	}
	if strings.ContainsAny(email, " \t\r\n\x00") {
		return false
	}
	domain := email[at+1:]
	return strings.Contains(domain, ".") && !strings.HasPrefix(domain, ".") && !strings.HasSuffix(domain, ".")
}
