package server

import (
	"bytes"
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

func issueMobilePairingCode(t *testing.T, environment *adminEnvironment, token string, userID string) protocol.MobilePairingCodeResponse {
	t.Helper()
	body := map[string]string{}
	if userID != "" {
		body["userId"] = userID
	}
	status, response := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/mobile/pairing-codes", token, body)
	if status != http.StatusCreated {
		t.Fatalf("create mobile pairing code status=%d body=%s", status, response)
	}
	var code protocol.MobilePairingCodeResponse
	decodeTestJSON(t, response, &code)
	if code.Code == "" || code.ExpiresAt.IsZero() || code.UserID == "" || code.PairingURL == "" {
		t.Fatalf("invalid mobile pairing code response: %+v", code)
	}
	if !bytes.Contains([]byte(code.PairingURL), []byte("dshconnect://pair?")) || !bytes.Contains([]byte(code.PairingURL), []byte(code.Code)) {
		t.Fatalf("pairing URL does not contain the code: %s", code.PairingURL)
	}
	return code
}

func pairMobile(t *testing.T, environment *adminEnvironment, code, deviceName string) protocol.MobileSessionResponse {
	t.Helper()
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/pair", "", map[string]string{
		"code":       code,
		"deviceName": deviceName,
		"platform":   "ios",
		"appVersion": "0.1.0",
	})
	if status != http.StatusOK {
		t.Fatalf("mobile pair status=%d body=%s", status, body)
	}
	var session protocol.MobileSessionResponse
	decodeTestJSON(t, body, &session)
	if session.MobileDeviceID == "" || session.User.ID == "" || session.AccessToken == "" || session.RefreshToken == "" || session.AccessTokenExpiresAt.IsZero() || session.RefreshTokenExpiresAt.IsZero() {
		t.Fatalf("invalid mobile session response: %+v", session)
	}
	if !bytes.HasPrefix([]byte(session.AccessToken), []byte("mat_")) || !bytes.HasPrefix([]byte(session.RefreshToken), []byte("mrt_")) {
		t.Fatalf("unexpected mobile token prefixes: %+v", session)
	}
	return session
}

func TestMobilePairingRefreshAndLogoutLifecycle(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)

	code := issueMobilePairingCode(t, environment, ownerToken, "")
	if code.UserID != ownerID || code.ServerURL != "http://server.test" {
		t.Fatalf("unexpected pairing code target: %+v", code)
	}
	pair := pairMobile(t, environment, code.Code, "Owner iPhone")
	if pair.User.ID != ownerID || pair.User.Email != testOwnerEmail {
		t.Fatalf("mobile user projection=%+v", pair.User)
	}

	// Mobile access tokens do not grant session/device APIs until desktop grants
	// are mapped to mobile users.
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/devices", pair.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)

	// The plaintext code and both credentials must never be persisted.
	deviceDump := dumpTable(t, environment.databaseURL, "mobile_devices")
	if bytes.Contains([]byte(deviceDump), []byte(pair.AccessToken)) || bytes.Contains([]byte(deviceDump), []byte(pair.RefreshToken)) {
		t.Fatal("plaintext mobile credentials were persisted")
	}
	codeDump := dumpTable(t, environment.databaseURL, "mobile_pairing_codes")
	if bytes.Contains([]byte(codeDump), []byte(code.Code)) {
		t.Fatal("plaintext mobile pairing code was persisted")
	}

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", pair.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("mobile me status=%d body=%s", status, body)
	}
	var me protocol.MobileMeResponse
	decodeTestJSON(t, body, &me)
	if me.MobileDevice.MobileDeviceID != pair.MobileDeviceID || me.User.ID != ownerID || me.MobileDevice.Platform != "ios" {
		t.Fatalf("unexpected mobile me: %+v", me)
	}

	// Reusing the one-time code fails and does not create a second phone.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/pair", "", map[string]string{
		"code": code.Code, "deviceName": "Replay iPhone", "platform": "ios", "appVersion": "0.1.0",
	})
	assertErrorResponse(t, status, body, http.StatusConflict, protocol.CodePairingCodeUsed)

	// Refreshing rotates both credentials.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/refresh", "", map[string]string{
		"refreshToken": pair.RefreshToken,
	})
	if status != http.StatusOK {
		t.Fatalf("mobile refresh status=%d body=%s", status, body)
	}
	var refreshed protocol.MobileSessionResponse
	decodeTestJSON(t, body, &refreshed)
	if refreshed.AccessToken == pair.AccessToken || refreshed.RefreshToken == pair.RefreshToken {
		t.Fatalf("refresh did not rotate tokens: %+v", refreshed)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", pair.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/refresh", "", map[string]string{
		"refreshToken": pair.RefreshToken,
	})
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", refreshed.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("rotated access token status=%d body=%s", status, body)
	}

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/logout", refreshed.AccessToken, nil)
	if status != http.StatusNoContent {
		t.Fatalf("mobile logout status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", refreshed.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/refresh", "", map[string]string{
		"refreshToken": refreshed.RefreshToken,
	})
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)

	// Pairing and refresh are audited without leaking credentials.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/audit?action=mobile.pair&result=success", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("mobile audit status=%d body=%s", status, body)
	}
	var audit auditListResponse
	decodeTestJSON(t, body, &audit)
	if audit.Total != 1 || audit.Entries[0].Actor != "user:"+ownerID || audit.Entries[0].DeviceID != pair.MobileDeviceID {
		t.Fatalf("unexpected mobile pair audit: %+v", audit.Entries)
	}
	if bytes.Contains(body, []byte(pair.AccessToken)) || bytes.Contains(body, []byte(pair.RefreshToken)) {
		t.Fatal("mobile audit leaked a credential")
	}
}

func TestMobilePairingCodeExpiryAndValidation(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/pair", "", map[string]string{
		"code": "invalid", "deviceName": "Bad iPhone", "platform": "windows", "appVersion": "0.1.0",
	})
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/pair", "", map[string]string{
		"code": "INVALID-CODE", "deviceName": "Bad iPhone", "platform": "ios", "appVersion": "0.1.0",
	})
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodePairingCodeInvalid)

	// Bootstrap callers must identify the target user explicitly.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/mobile/pairing-codes", testBootstrapToken, map[string]string{})
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)
	bootstrapCode := issueMobilePairingCode(t, environment, testBootstrapToken, ownerID)
	if bootstrapCode.UserID != ownerID {
		t.Fatalf("bootstrap pairing code target=%q, want %q", bootstrapCode.UserID, ownerID)
	}

	expiring := newAdminEnvironment(t)
	expiring.server.config.MobilePairingCodeTTL = 10 * time.Millisecond
	expiringOwnerToken, _ := expiring.login(t, testOwnerEmail, testOwnerPassword)
	expiringCode := issueMobilePairingCode(t, expiring, expiringOwnerToken, "")
	time.Sleep(40 * time.Millisecond)
	status, body = testRequest(t, http.MethodPost, expiring.http.URL+"/v1/mobile/pair", "", map[string]string{
		"code": expiringCode.Code, "deviceName": "Late iPhone", "platform": "ios", "appVersion": "0.1.0",
	})
	assertErrorResponse(t, status, body, http.StatusConflict, protocol.CodePairingCodeExpired)

	// A code issued for another user is bound to that user, not the issuer.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": "mobile-member@example.com", "displayName": "Mobile Member", "password": "member-password", "role": store.RoleMember,
	})
	if status != http.StatusCreated {
		t.Fatalf("create member status=%d body=%s", status, body)
	}
	var member store.User
	decodeTestJSON(t, body, &member)
	memberCode := issueMobilePairingCode(t, environment, ownerToken, member.ID)
	if memberCode.UserID != member.ID {
		t.Fatalf("pairing code target=%q, want %q", memberCode.UserID, member.ID)
	}
	memberSession := pairMobile(t, environment, memberCode.Code, "Member iPhone")
	if memberSession.User.ID != member.ID || memberSession.User.Role != store.RoleMember {
		t.Fatalf("mobile session user=%+v", memberSession.User)
	}
}

func TestMobilePairingPermissionsAndAdminRevocation(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": "phone-member@example.com", "displayName": "Phone Member", "password": "member-password", "role": store.RoleMember,
	})
	if status != http.StatusCreated {
		t.Fatalf("create member status=%d body=%s", status, body)
	}
	var member store.User
	decodeTestJSON(t, body, &member)
	memberToken, _ := environment.login(t, member.Email, "member-password")

	// Members may issue a code for themselves, but not for another user.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/mobile/pairing-codes", memberToken, map[string]string{})
	if status != http.StatusCreated {
		t.Fatalf("member self pairing code status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/mobile/pairing-codes", memberToken, map[string]string{
		"userId": "usr_owner",
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	code := issueMobilePairingCode(t, environment, ownerToken, member.ID)
	session := pairMobile(t, environment, code.Code, "Member iPhone")

	// Members cannot enumerate or revoke phones.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/mobile-devices", memberToken, nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/mobile-devices/"+session.MobileDeviceID+"/revoke", memberToken, nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	// Owners can inspect phone metadata but never credentials.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/mobile-devices", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("list mobile devices status=%d body=%s", status, body)
	}
	var listed protocol.MobileDeviceListResponse
	decodeTestJSON(t, body, &listed)
	if len(listed.Devices) != 1 || listed.Devices[0].MobileDeviceID != session.MobileDeviceID || listed.Devices[0].Status != "active" || listed.Devices[0].UserID != member.ID {
		t.Fatalf("unexpected mobile devices: %+v", listed.Devices)
	}
	if bytes.Contains(body, []byte(session.AccessToken)) || bytes.Contains(body, []byte(session.RefreshToken)) {
		t.Fatal("mobile device listing leaked a credential")
	}

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/mobile-devices/"+session.MobileDeviceID+"/revoke", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("revoke mobile device status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", session.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/refresh", "", map[string]string{"refreshToken": session.RefreshToken})
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/mobile-devices", ownerToken, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"status":"revoked"`)) {
		t.Fatalf("revoked mobile device status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/mobile-devices/mob_missing/revoke", ownerToken, nil)
	assertErrorResponse(t, status, body, http.StatusNotFound, protocol.CodeNotFound)
}

func TestDisabledUserInvalidatesMobileAccess(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": "disabled-mobile@example.com", "displayName": "Disabled Mobile", "password": "member-password", "role": store.RoleMember,
	})
	if status != http.StatusCreated {
		t.Fatalf("create member status=%d body=%s", status, body)
	}
	var member store.User
	decodeTestJSON(t, body, &member)
	code := issueMobilePairingCode(t, environment, ownerToken, member.ID)
	session := pairMobile(t, environment, code.Code, "Disabled iPhone")

	status, body = testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/users/"+member.ID, ownerToken, map[string]string{
		"status": store.UserStatusDisabled,
	})
	if status != http.StatusOK {
		t.Fatalf("disable user status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", session.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/refresh", "", map[string]string{
		"refreshToken": session.RefreshToken,
	})
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
}

func TestDeletingUserRemovesMobileIdentity(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": "delete-mobile@example.com", "displayName": "Delete Mobile", "password": "member-password", "role": store.RoleMember,
	})
	if status != http.StatusCreated {
		t.Fatalf("create member status=%d body=%s", status, body)
	}
	var member store.User
	decodeTestJSON(t, body, &member)
	code := issueMobilePairingCode(t, environment, ownerToken, member.ID)
	session := pairMobile(t, environment, code.Code, "Delete iPhone")

	status, body = testRequest(t, http.MethodDelete, environment.http.URL+"/v1/admin/users/"+member.ID, ownerToken, nil)
	if status != http.StatusNoContent {
		t.Fatalf("delete user status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", session.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	records, err := environment.server.store.MobileDevices(context.Background())
	if err != nil {
		t.Fatalf("list mobile devices: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("deleted user left mobile devices: %+v", records)
	}
}
