package server

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

type mobileContextKey struct{}

type mobileActor struct {
	Device store.MobileDeviceRecord
	User   store.User
}

// mobileAuth authenticates a paired phone with its short-lived access token.
// It never accepts the bootstrap or Web Admin credentials.
func (s *Server) mobileAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok || token == "" {
			writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile access token required", false))
			return
		}
		device, user, err := s.store.AuthenticateMobileAccess(r.Context(), store.HashToken(token), nowUTC())
		if err != nil {
			writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile access token is invalid or expired", false))
			return
		}
		actor := mobileActor{Device: device, User: user}
		next(w, r.WithContext(context.WithValue(r.Context(), mobileContextKey{}, actor)))
	}
}

// mobileAuthWS is the WebSocket variant of mobileAuth. Browsers cannot set
// custom Authorization headers on a WebSocket handshake, so a short-lived
// access token may also arrive as a query parameter. Prefer the header on
// native clients; never use the query form for ordinary HTTP APIs.
func (s *Server) mobileAuthWS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok || token == "" {
			token = r.URL.Query().Get("accessToken")
		}
		if token == "" {
			writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile access token required", false))
			return
		}
		device, user, err := s.store.AuthenticateMobileAccess(r.Context(), store.HashToken(token), nowUTC())
		if err != nil {
			writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile access token is invalid or expired", false))
			return
		}
		actor := mobileActor{Device: device, User: user}
		next(w, r.WithContext(context.WithValue(r.Context(), mobileContextKey{}, actor)))
	}
}

func mobileFromContext(ctx context.Context) (mobileActor, bool) {
	actor, ok := ctx.Value(mobileContextKey{}).(mobileActor)
	return actor, ok
}

func (s *Server) mobileRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/mobile/pair", s.handleMobilePair)
	mux.HandleFunc("POST /v1/mobile/auth/refresh", s.handleMobileRefresh)
	mux.HandleFunc("POST /v1/mobile/auth/logout", s.mobileAuth(s.handleMobileLogout))
	mux.HandleFunc("GET /v1/mobile/me", s.mobileAuth(s.handleMobileMe))
	mux.HandleFunc("GET /v1/mobile/events/ws", s.mobileAuthWS(s.handleMobileEvents))
	s.mobileAccessRoutes(mux)
	s.mobileInteractionRoutes(mux)

	mux.HandleFunc("POST /v1/admin/mobile/pairing-codes", s.adminAuth(s.handleAdminCreateMobilePairingCode))
	mux.HandleFunc("GET /v1/admin/mobile-devices", s.requireRole(store.RoleOwner, store.RoleAdmin, store.RoleAuditor)(s.handleAdminMobileDevices))
	mux.HandleFunc("POST /v1/admin/mobile-devices/{mobileDeviceId}/revoke", s.requireRole(store.RoleOwner, store.RoleAdmin)(s.handleAdminRevokeMobileDevice))
}

// handleAdminCreateMobilePairingCode issues a one-time code for a specific user.
// A non-bootstrap caller may omit userId to pair their own phone; issuing for
// another user requires the owner or admin role.
func (s *Server) handleAdminCreateMobilePairingCode(w http.ResponseWriter, r *http.Request) {
	var request protocol.MobilePairingCodeRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	actor, ok := adminFromContext(r.Context())
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "authentication required", false))
		return
	}
	targetUserID := request.UserID
	if targetUserID == "" {
		if actor.ViaBearer {
			writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "userId is required when using the bootstrap token", false))
			return
		}
		targetUserID = actor.User.ID
	} else if !validID(targetUserID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid userId required", false))
		return
	}
	if targetUserID != actor.User.ID && actor.User.Role != store.RoleOwner && actor.User.Role != store.RoleAdmin {
		writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "only an owner or admin can issue a pairing code for another user", false))
		return
	}
	targetUser, err := s.store.UserByID(r.Context(), targetUserID)
	if errors.Is(err, store.ErrUserNotFound) {
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "user not found", false))
		return
	}
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load user", true))
		return
	}
	if targetUser.Status != store.UserStatusActive {
		writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "user is disabled", false))
		return
	}

	code, err := randomPairingCode()
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate mobile pairing code", true))
		return
	}
	now := nowUTC()
	expiresAt := now.Add(s.config.MobilePairingCodeTTL)
	pairingURL, err := mobilePairingURL(s.config.ServerURL, code)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "server URL cannot be encoded as a mobile pairing link", false))
		return
	}
	if err := s.store.CreateMobilePairingCode(r.Context(), store.MobilePairingCode{
		CodeHash:  store.HashToken(code),
		UserID:    targetUser.ID,
		CreatedAt: now,
		ExpiresAt: expiresAt,
	}); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not persist mobile pairing code", true))
		return
	}
	s.audit(store.AuditEntry{
		OccurredAt: now,
		Actor:      auditActor(r),
		Action:     "admin.mobile_pairing_code.create",
		Result:     "success",
		SourceIP:   sourceIP(r),
	})
	writeJSON(w, http.StatusCreated, protocol.MobilePairingCodeResponse{
		Code:       code,
		ExpiresAt:  expiresAt,
		ServerURL:  s.config.ServerURL,
		PairingURL: pairingURL,
		UserID:     targetUser.ID,
	})
}

func (s *Server) handleMobilePair(w http.ResponseWriter, r *http.Request) {
	var request protocol.MobilePairRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	request.Code = normalizeMobilePairingCode(request.Code)
	request.DeviceName = strings.TrimSpace(request.DeviceName)
	request.AppVersion = strings.TrimSpace(request.AppVersion)
	if !validText(request.Code, 128) || !validText(request.DeviceName, 128) || !validText(request.AppVersion, 64) || !validMobilePlatform(request.Platform) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "code, deviceName, platform (ios|android) and appVersion are required", false))
		return
	}

	now := nowUTC()
	mobileDeviceID, err := randomToken("mob_")
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate mobile device identity", true))
		return
	}
	accessToken, refreshToken, credential, err := s.newMobileCredential(now)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate mobile credentials", true))
		return
	}
	device, user, err := s.store.RedeemMobilePairingCode(r.Context(), store.HashToken(request.Code), store.MobileDeviceRecord{
		Device: protocol.MobileDevice{
			MobileDeviceID: mobileDeviceID,
			DeviceName:     request.DeviceName,
			Platform:       request.Platform,
			AppVersion:     request.AppVersion,
			Status:         "active",
			CreatedAt:      now,
			UpdatedAt:      now,
			LastSeenAt:     &now,
		},
	}, credential, now)
	if err != nil {
		commandError := mobilePairingError(err)
		s.audit(store.AuditEntry{
			OccurredAt: now,
			Actor:      "anonymous",
			Action:     "mobile.pair",
			Result:     "error",
			ErrorCode:  commandError.Code,
			SourceIP:   sourceIP(r),
		})
		writeAPIError(w, commandError)
		return
	}
	s.audit(store.AuditEntry{
		OccurredAt: now,
		Actor:      "user:" + user.ID,
		Action:     "mobile.pair",
		DeviceID:   device.Device.MobileDeviceID,
		Result:     "success",
		SourceIP:   sourceIP(r),
	})
	writeJSON(w, http.StatusOK, mobileSessionResponse(device, user, accessToken, refreshToken, credential))
}

func (s *Server) handleMobileRefresh(w http.ResponseWriter, r *http.Request) {
	var request protocol.MobileRefreshRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if !validText(request.RefreshToken, 512) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "refreshToken is required", false))
		return
	}
	now := nowUTC()
	accessToken, refreshToken, credential, err := s.newMobileCredential(now)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not generate mobile credentials", true))
		return
	}
	device, user, err := s.store.RotateMobileRefresh(r.Context(), store.HashToken(request.RefreshToken), credential, now)
	if err != nil {
		if errors.Is(err, store.ErrMobileSessionInvalid) || errors.Is(err, store.ErrUserNotFound) {
			s.audit(store.AuditEntry{
				OccurredAt: now,
				Actor:      "anonymous",
				Action:     "mobile.token.refresh",
				Result:     "error",
				ErrorCode:  protocol.CodeUnauthorized,
				SourceIP:   sourceIP(r),
			})
			writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "refresh token is invalid, expired, or already used", false))
			return
		}
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not refresh mobile session", true))
		return
	}
	s.audit(store.AuditEntry{
		OccurredAt: now,
		Actor:      "user:" + user.ID,
		Action:     "mobile.token.refresh",
		DeviceID:   device.Device.MobileDeviceID,
		Result:     "success",
		SourceIP:   sourceIP(r),
	})
	writeJSON(w, http.StatusOK, mobileSessionResponse(device, user, accessToken, refreshToken, credential))
}

func (s *Server) handleMobileLogout(w http.ResponseWriter, r *http.Request) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
		return
	}
	now := nowUTC()
	if err := s.store.RevokeMobileDevice(r.Context(), actor.Device.Device.MobileDeviceID, now); err != nil {
		if errors.Is(err, store.ErrMobileDeviceNotFound) {
			writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile session is no longer active", false))
			return
		}
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not revoke mobile session", true))
		return
	}
	s.events.CloseMobile(actor.Device.Device.MobileDeviceID)
	// Access grants must never outlive the phone credential that asked for them.
	if err := s.store.RevokeMobileAccessGrantsForMobileDevice(r.Context(), actor.Device.Device.MobileDeviceID, now); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not revoke mobile access grants", true))
		return
	}
	s.audit(store.AuditEntry{
		OccurredAt: now,
		Actor:      "user:" + actor.User.ID,
		Action:     "mobile.logout",
		DeviceID:   actor.Device.Device.MobileDeviceID,
		Result:     "success",
		SourceIP:   sourceIP(r),
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMobileMe(w http.ResponseWriter, r *http.Request) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
		return
	}
	writeJSON(w, http.StatusOK, protocol.MobileMeResponse{
		MobileDevice: actor.Device.Device,
		User:         mobileUser(actor.User),
	})
}

func (s *Server) handleAdminMobileDevices(w http.ResponseWriter, r *http.Request) {
	records, err := s.store.MobileDevices(r.Context())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load mobile devices", true))
		return
	}
	devices := make([]protocol.MobileDevice, 0, len(records))
	for _, record := range records {
		devices = append(devices, record.Device)
	}
	writeJSON(w, http.StatusOK, protocol.MobileDeviceListResponse{Devices: devices})
}

func (s *Server) handleAdminRevokeMobileDevice(w http.ResponseWriter, r *http.Request) {
	mobileDeviceID := r.PathValue("mobileDeviceId")
	if !validID(mobileDeviceID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid mobileDeviceId required", false))
		return
	}
	now := nowUTC()
	if err := s.store.RevokeMobileDevice(r.Context(), mobileDeviceID, now); err != nil {
		if errors.Is(err, store.ErrMobileDeviceNotFound) {
			writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "mobile device not found", false))
			return
		}
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not revoke mobile device", true))
		return
	}
	s.events.CloseMobile(mobileDeviceID)
	if err := s.store.RevokeMobileAccessGrantsForMobileDevice(r.Context(), mobileDeviceID, now); err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not revoke mobile access grants", true))
		return
	}
	s.audit(store.AuditEntry{
		OccurredAt: nowUTC(),
		Actor:      auditActor(r),
		Action:     "admin.mobile_device.revoke",
		DeviceID:   mobileDeviceID,
		Result:     "success",
		SourceIP:   sourceIP(r),
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (s *Server) newMobileCredential(now time.Time) (string, string, store.MobileCredential, error) {
	accessToken, err := randomToken("mat_")
	if err != nil {
		return "", "", store.MobileCredential{}, err
	}
	refreshToken, err := randomToken("mrt_")
	if err != nil {
		return "", "", store.MobileCredential{}, err
	}
	return accessToken, refreshToken, store.MobileCredential{
		AccessTokenHash:  store.HashToken(accessToken),
		RefreshTokenHash: store.HashToken(refreshToken),
		AccessExpiresAt:  now.Add(s.config.MobileAccessTokenTTL),
		RefreshExpiresAt: now.Add(s.config.MobileRefreshTokenTTL),
	}, nil
}

func mobileSessionResponse(device store.MobileDeviceRecord, user store.User, accessToken, refreshToken string, credential store.MobileCredential) protocol.MobileSessionResponse {
	return protocol.MobileSessionResponse{
		MobileDeviceID:        device.Device.MobileDeviceID,
		User:                  mobileUser(user),
		AccessToken:           accessToken,
		AccessTokenExpiresAt:  credential.AccessExpiresAt,
		RefreshToken:          refreshToken,
		RefreshTokenExpiresAt: credential.RefreshExpiresAt,
	}
}

func mobileUser(user store.User) protocol.MobileUser {
	return protocol.MobileUser{
		ID:          user.ID,
		Email:       user.Email,
		DisplayName: user.DisplayName,
		Role:        user.Role,
	}
}

func mobilePairingURL(serverURL, code string) (string, error) {
	base, err := url.Parse(serverURL)
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" {
		return "", errors.New("invalid server URL")
	}
	pairing := &url.URL{Scheme: "dshconnect", Host: "pair"}
	query := pairing.Query()
	query.Set("v", "1")
	query.Set("server", strings.TrimRight(serverURL, "/"))
	query.Set("code", code)
	pairing.RawQuery = query.Encode()
	return pairing.String(), nil
}

func normalizeMobilePairingCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

func validMobilePlatform(platform string) bool {
	return platform == "ios" || platform == "android"
}

func mobilePairingError(err error) protocol.Error {
	switch {
	case errors.Is(err, store.ErrPairingCodeUsed):
		return protocol.NewError(protocol.CodePairingCodeUsed, "mobile pairing code has already been used", false)
	case errors.Is(err, store.ErrPairingCodeExpired):
		return protocol.NewError(protocol.CodePairingCodeExpired, "mobile pairing code has expired", false)
	case errors.Is(err, store.ErrUserDisabled):
		return protocol.NewError(protocol.CodeForbidden, "user is disabled", false)
	case errors.Is(err, store.ErrPairingCodeInvalid), errors.Is(err, store.ErrUserNotFound):
		return protocol.NewError(protocol.CodePairingCodeInvalid, "mobile pairing code is invalid", false)
	default:
		return protocol.NewError(protocol.CodeInternalError, "could not complete mobile pairing", true)
	}
}
