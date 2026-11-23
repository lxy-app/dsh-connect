package server

import (
	"bytes"
	"context"
	"net/http"
	"testing"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

func loginMobile(t *testing.T, environment *adminEnvironment, email, password, deviceName string) protocol.MobileSessionResponse {
	t.Helper()
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/login", "", map[string]string{
		"email":      email,
		"password":   password,
		"deviceName": deviceName,
		"platform":   "ios",
		"appVersion": "0.1.0",
	})
	if status != http.StatusOK {
		t.Fatalf("mobile login status=%d body=%s", status, body)
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

func TestMobileLoginRefreshAndLogoutLifecycle(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)
	session := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Owner iPhone")
	if session.User.ID != ownerID || session.User.Email != testOwnerEmail {
		t.Fatalf("mobile user projection=%+v", session.User)
	}

	// Mobile access tokens never authenticate bootstrap/Web Admin APIs.
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/devices", session.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)

	// The plaintext password and both credentials must never be persisted.
	deviceDump := dumpTable(t, environment.databaseURL, "mobile_devices")
	if bytes.Contains([]byte(deviceDump), []byte(session.AccessToken)) || bytes.Contains([]byte(deviceDump), []byte(session.RefreshToken)) || bytes.Contains([]byte(deviceDump), []byte(testOwnerPassword)) {
		t.Fatal("plaintext mobile login or credential material was persisted")
	}

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", session.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("mobile me status=%d body=%s", status, body)
	}
	var me protocol.MobileMeResponse
	decodeTestJSON(t, body, &me)
	if me.MobileDevice.MobileDeviceID != session.MobileDeviceID || me.User.ID != ownerID || me.MobileDevice.Platform != "ios" {
		t.Fatalf("unexpected mobile me: %+v", me)
	}

	// A normal refresh rotates both credentials and invalidates the old access
	// token. The retired refresh token stays reusable for a bounded grace.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/refresh", "", map[string]string{
		"refreshToken": session.RefreshToken,
	})
	if status != http.StatusOK {
		t.Fatalf("mobile refresh status=%d body=%s", status, body)
	}
	var refreshed protocol.MobileSessionResponse
	decodeTestJSON(t, body, &refreshed)
	if refreshed.MobileDeviceID != session.MobileDeviceID || refreshed.AccessToken == session.AccessToken || refreshed.RefreshToken == session.RefreshToken {
		t.Fatalf("refresh did not rotate the same device credentials: %+v", refreshed)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", session.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	// A phone that lost the rotation response retries with the token it still
	// holds. Inside the reuse grace the Server renews only the access token and
	// keeps that refresh token, so the client that did receive the rotation is
	// not stranded either.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/refresh", "", map[string]string{
		"refreshToken": session.RefreshToken,
	})
	if status != http.StatusOK {
		t.Fatalf("mobile reuse refresh status=%d body=%s", status, body)
	}
	var replayed protocol.MobileSessionResponse
	decodeTestJSON(t, body, &replayed)
	if replayed.MobileDeviceID != session.MobileDeviceID || replayed.RefreshToken != session.RefreshToken ||
		replayed.AccessToken == refreshed.AccessToken || replayed.AccessToken == session.AccessToken {
		t.Fatalf("reuse refresh did not keep the presented refresh token: %+v", replayed)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", refreshed.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", replayed.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("replayed access token status=%d body=%s", status, body)
	}

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/logout", replayed.AccessToken, nil)
	if status != http.StatusNoContent {
		t.Fatalf("mobile logout status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/mobile/me", replayed.AccessToken, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/refresh", "", map[string]string{
		"refreshToken": replayed.RefreshToken,
	})
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/refresh", "", map[string]string{
		"refreshToken": refreshed.RefreshToken,
	})
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)

	// Login is audited by user and mobile device without leaking secrets.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/audit?action=mobile.login&result=success", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("mobile audit status=%d body=%s", status, body)
	}
	var audit auditListResponse
	decodeTestJSON(t, body, &audit)
	if audit.Total != 1 || audit.Entries[0].Actor != "user:"+ownerID || audit.Entries[0].DeviceID != session.MobileDeviceID {
		t.Fatalf("unexpected mobile login audit: %+v", audit.Entries)
	}
	if bytes.Contains(body, []byte(session.AccessToken)) || bytes.Contains(body, []byte(session.RefreshToken)) || bytes.Contains(body, []byte(testOwnerPassword)) {
		t.Fatal("mobile audit leaked login or credential material")
	}
}

func TestMobileLoginValidationAndAccountIdentity(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)

	loginBody := map[string]string{
		"email": testOwnerEmail, "password": "wrong-password", "deviceName": "Bad iPhone", "platform": "ios", "appVersion": "0.1.0",
	}
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/login", "", loginBody)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	wrongPasswordResponse := append([]byte(nil), body...)
	loginBody["email"] = "missing-mobile@example.com"
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/login", "", loginBody)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	if !bytes.Equal(body, wrongPasswordResponse) {
		t.Fatalf("unknown email and wrong password responses differ: unknown=%s wrong=%s", body, wrongPasswordResponse)
	}

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/login", "", map[string]string{
		"email": testOwnerEmail, "password": testOwnerPassword, "deviceName": "Bad iPhone", "platform": "windows", "appVersion": "0.1.0",
	})
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/login", "", map[string]any{
		"email": testOwnerEmail, "password": testOwnerPassword, "deviceName": "Bad iPhone", "platform": "ios", "appVersion": "0.1.0", "userId": "usr_other",
	})
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": "mobile-member@example.com", "displayName": "Mobile Member", "password": "member-password", "role": store.RoleMember,
	})
	if status != http.StatusCreated {
		t.Fatalf("create member status=%d body=%s", status, body)
	}
	var member store.User
	decodeTestJSON(t, body, &member)
	memberSession := loginMobile(t, environment, member.Email, "member-password", "Member iPhone")
	if memberSession.User.ID != member.ID || memberSession.User.Role != store.RoleMember {
		t.Fatalf("mobile session user=%+v", memberSession.User)
	}
}

func TestMobileLoginRateLimitAndSuccessReset(t *testing.T) {
	environment := newAdminEnvironment(t)
	loginURL := environment.http.URL + "/v1/mobile/auth/login"
	failedBody := func() map[string]string {
		return map[string]string{
			"email": testOwnerEmail, "password": "wrong-password", "deviceName": "Rate Limit iPhone", "platform": "ios", "appVersion": "0.1.0",
		}
	}

	// Four failures are still below the threshold; a successful login clears them.
	for attempt := 1; attempt < mobileLoginMaxFailures; attempt++ {
		status, body := testRequest(t, http.MethodPost, loginURL, "", failedBody())
		assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	}
	loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Successful Reset iPhone")

	// If success had not reset the key, the first request here would reach the
	// threshold. Five fresh failures must all remain ordinary unauthorized responses.
	for attempt := 1; attempt <= mobileLoginMaxFailures; attempt++ {
		status, body := testRequest(t, http.MethodPost, loginURL, "", failedBody())
		assertErrorResponse(t, status, body, http.StatusUnauthorized, protocol.CodeUnauthorized)
	}
	status, body := testRequest(t, http.MethodPost, loginURL, "", map[string]string{
		"email": testOwnerEmail, "password": testOwnerPassword, "deviceName": "Blocked iPhone", "platform": "ios", "appVersion": "0.1.0",
	})
	assertErrorResponse(t, status, body, http.StatusTooManyRequests, protocol.CodeRateLimited)
}

func TestMobileDeviceAdminPermissionsAndRevocation(t *testing.T) {
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
	session := loginMobile(t, environment, member.Email, "member-password", "Member iPhone")

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
		t.Fatalf("unexpected mobile devices: %+v", listed)
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
	session := loginMobile(t, environment, member.Email, "member-password", "Disabled iPhone")

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
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/auth/login", "", map[string]string{
		"email": member.Email, "password": "member-password", "deviceName": "Disabled Login", "platform": "ios", "appVersion": "0.1.0",
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
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
	session := loginMobile(t, environment, member.Email, "member-password", "Delete iPhone")

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
