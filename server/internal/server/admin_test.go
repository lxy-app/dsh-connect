package server

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

const (
	testOwnerEmail    = "owner@example.com"
	testOwnerPassword = "owner-password-123"
)

// adminEnvironment boots a server with a seeded owner account.
type adminEnvironment struct {
	*testEnvironment
	ownerEmail    string
	ownerPassword string
}

func newAdminEnvironment(t *testing.T) *adminEnvironment {
	t.Helper()
	environment := newTestEnvironment(t, func(config *Config) {
		config.BootstrapOwnerEmail = testOwnerEmail
		config.BootstrapOwnerPassword = testOwnerPassword
		config.BootstrapOwnerName = "Test Owner"
	})
	return &adminEnvironment{testEnvironment: environment, ownerEmail: testOwnerEmail, ownerPassword: testOwnerPassword}
}

// login authenticates as the seeded owner and returns the session token.
func (e *adminEnvironment) login(t *testing.T, email, password string) (string, string) {
	t.Helper()
	status, body := testRequest(t, http.MethodPost, e.http.URL+"/v1/admin/auth/login", "", map[string]string{
		"email":    email,
		"password": password,
	})
	if status != http.StatusOK {
		t.Fatalf("login status=%d body=%s", status, body)
	}
	var response loginResponse
	decodeTestJSON(t, body, &response)
	if response.Token == "" || response.User.Email == "" {
		t.Fatalf("unexpected login response: %+v", response)
	}
	return response.Token, response.User.ID
}

func TestAdminBootstrapCreatesExactlyOneOwner(t *testing.T) {
	environment := newAdminEnvironment(t)

	// Restarting against the same database must not duplicate or overwrite the
	// owner account.
	restarted, err := New(context.Background(), Config{
		BootstrapToken:         testBootstrapToken,
		DatabaseURL:            environment.databaseURL,
		ServerURL:              "http://server.test",
		BootstrapOwnerEmail:    testOwnerEmail,
		BootstrapOwnerPassword: "a-completely-different-password",
	})
	if err != nil {
		t.Fatalf("restart New() error: %v", err)
	}
	defer restarted.Close()

	users, err := restarted.Store().Users(context.Background())
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if len(users) != 1 || users[0].Role != store.RoleOwner {
		t.Fatalf("expected exactly one owner, got %+v", users)
	}
	// The original password still works, proving the account was not rewritten.
	environment.login(t, testOwnerEmail, testOwnerPassword)
}

func TestAdminLoginRejectsBadCredentialsAndDisabledAccounts(t *testing.T) {
	environment := newAdminEnvironment(t)

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/auth/login", "", map[string]string{
		"email": testOwnerEmail, "password": "wrong-password",
	})
	assertErrorResponse(t, status, body, http.StatusUnauthorized, "unauthorized")

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/auth/login", "", map[string]string{
		"email": "nobody@example.com", "password": testOwnerPassword,
	})
	assertErrorResponse(t, status, body, http.StatusUnauthorized, "unauthorized")

	// Disabling the account must invalidate new logins while keeping the row.
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": "member@example.com", "displayName": "Member", "password": "member-password", "role": store.RoleMember,
	})
	if status != http.StatusCreated {
		t.Fatalf("create member status=%d body=%s", status, body)
	}
	var member store.User
	decodeTestJSON(t, body, &member)

	status, body = testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/users/"+member.ID, ownerToken, map[string]string{
		"status": store.UserStatusDisabled,
	})
	if status != http.StatusOK {
		t.Fatalf("disable member status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/auth/login", "", map[string]string{
		"email": "member@example.com", "password": "member-password",
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, "forbidden")

	// The owner must remain usable.
	if _, ownerIDCheck := environment.login(t, testOwnerEmail, testOwnerPassword); ownerIDCheck != ownerID {
		t.Fatalf("owner id changed between logins")
	}
}

func TestAdminSessionTokenIsHashedAndRevocable(t *testing.T) {
	environment := newAdminEnvironment(t)
	token, _ := environment.login(t, testOwnerEmail, testOwnerPassword)

	// The plaintext token must not be stored.
	persisted := dumpTable(t, environment.databaseURL, "admin_sessions")
	if bytes.Contains([]byte(persisted), []byte(token)) {
		t.Fatal("plaintext admin session token was persisted")
	}
	if !bytes.Contains([]byte(persisted), []byte(store.HashToken(token))) {
		t.Fatal("hashed admin session token was not persisted")
	}

	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/auth/me", token, nil)
	if status != http.StatusOK {
		t.Fatalf("me status=%d body=%s", status, body)
	}

	status, _ = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/auth/logout", token, nil)
	if status != http.StatusNoContent {
		t.Fatalf("logout status=%d", status)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/auth/me", token, nil)
	assertErrorResponse(t, status, body, http.StatusUnauthorized, "unauthorized")
}

func TestAdminRolePermissions(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)

	// Create one admin, one member and one auditor.
	createUser := func(email, password, role string) store.User {
		t.Helper()
		status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
			"email": email, "displayName": email, "password": password, "role": role,
		})
		if status != http.StatusCreated {
			t.Fatalf("create %s status=%d body=%s", role, status, body)
		}
		var user store.User
		decodeTestJSON(t, body, &user)
		return user
	}
	adminUser := createUser("admin@example.com", "admin-password", store.RoleAdmin)
	memberUser := createUser("member2@example.com", "member-password", store.RoleMember)
	auditorUser := createUser("auditor@example.com", "auditor-password", store.RoleAuditor)

	adminToken, _ := environment.login(t, adminUser.Email, "admin-password")
	memberToken, _ := environment.login(t, memberUser.Email, "member-password")
	auditorToken, _ := environment.login(t, auditorUser.Email, "auditor-password")

	// Members may read their own profile but cannot list users.
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/users", memberToken, nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, "forbidden")

	// Auditors can read users and audit but cannot mutate anything.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/users", auditorToken, nil)
	if status != http.StatusOK {
		t.Fatalf("auditor list users status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/audit", auditorToken, nil)
	if status != http.StatusOK {
		t.Fatalf("auditor read audit status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", auditorToken, map[string]string{
		"email": "nope@example.com", "displayName": "Nope", "password": "nope-password", "role": store.RoleMember,
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, "forbidden")

	// Admins cannot promote anyone to owner.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", adminToken, map[string]string{
		"email": "wannabe-owner@example.com", "displayName": "Wannabe", "password": "wannabe-password", "role": store.RoleOwner,
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, "forbidden")

	// Admins cannot change roles at all.
	status, body = testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/users/"+memberUser.ID, adminToken, map[string]string{
		"role": store.RoleAdmin,
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, "forbidden")

	// Admins can still perform non-escalating edits.
	status, body = testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/users/"+memberUser.ID, adminToken, map[string]string{
		"displayName": "Renamed Member",
	})
	if status != http.StatusOK {
		t.Fatalf("admin rename member status=%d body=%s", status, body)
	}
}

func TestAdminCannotRemoveLastOwner(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)

	status, body := testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/users/"+ownerID, ownerToken, map[string]string{
		"role": store.RoleMember,
	})
	assertErrorResponse(t, status, body, http.StatusConflict, "conflict")

	status, body = testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/users/"+ownerID, ownerToken, map[string]string{
		"status": store.UserStatusDisabled,
	})
	assertErrorResponse(t, status, body, http.StatusConflict, "conflict")

	status, body = testRequest(t, http.MethodDelete, environment.http.URL+"/v1/admin/users/"+ownerID, ownerToken, nil)
	assertErrorResponse(t, status, body, http.StatusConflict, "conflict")
}

func TestAdminUserValidation(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)

	cases := []map[string]string{
		{"email": "not-an-email", "displayName": "X", "password": "long-enough", "role": store.RoleMember},
		{"email": "ok@example.com", "displayName": "", "password": "long-enough", "role": store.RoleMember},
		{"email": "ok@example.com", "displayName": "X", "password": "short", "role": store.RoleMember},
		{"email": "ok@example.com", "displayName": "X", "password": "long-enough", "role": "superuser"},
	}
	for _, payload := range cases {
		status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, payload)
		assertErrorResponse(t, status, body, http.StatusBadRequest, "invalid_request")
	}

	// Duplicate email is a conflict, not a validation error.
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": testOwnerEmail, "displayName": "Dup", "password": "duplicate-password", "role": store.RoleMember,
	})
	assertErrorResponse(t, status, body, http.StatusConflict, "conflict")

	// Unknown fields are rejected rather than ignored.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]any{
		"email": "extra@example.com", "displayName": "Extra", "password": "extra-password", "role": store.RoleMember, "isRoot": true,
	})
	assertErrorResponse(t, status, body, http.StatusBadRequest, "invalid_request")
}

func TestAdminDeviceRevokeDisconnectsConnector(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)

	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/devices", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("list devices status=%d body=%s", status, body)
	}
	var listed adminDeviceListResponse
	decodeTestJSON(t, body, &listed)
	if len(listed.Devices) != 1 || !listed.Devices[0].HasToken || listed.Devices[0].Status != "online" {
		t.Fatalf("unexpected admin devices: %+v", listed.Devices)
	}

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/devices/"+connector.deviceID+"/revoke", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("revoke device status=%d body=%s", status, body)
	}

	// The live connection is closed by the server.
	waitClosed(t, connector.connection)

	// The old device token can no longer authenticate.
	assertUpgradeRejected(t, environment.http.URL, connector.deviceToken)

	// Device row is kept but marked revoked and stripped of credentials. The
	// disconnect handler races with revocation, so poll until it settles.
	deadline := time.Now().Add(3 * time.Second)
	var record store.DeviceRecord
	var err error
	for time.Now().Before(deadline) {
		record, err = environment.server.store.Device(context.Background(), connector.deviceID)
		if err != nil {
			t.Fatalf("load revoked device: %v", err)
		}
		if record.Device.Status == "revoked" && record.DeviceTokenHash == "" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if record.Device.Status != "revoked" || record.DeviceTokenHash != "" {
		t.Fatalf("device not revoked: status=%q tokenHash=%q", record.Device.Status, record.DeviceTokenHash)
	}
}

func TestAdminAuditRecordsManagementActions(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": "audited@example.com", "displayName": "Audited", "password": "audited-password", "role": store.RoleMember,
	})
	if status != http.StatusCreated {
		t.Fatalf("create user status=%d body=%s", status, body)
	}

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/audit?action=admin.user.create", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("read audit status=%d body=%s", status, body)
	}
	var audit auditListResponse
	decodeTestJSON(t, body, &audit)
	if audit.Total < 1 || len(audit.Entries) < 1 {
		t.Fatalf("expected create audit entry, got %+v", audit)
	}
	if audit.Entries[0].Action != "admin.user.create" || audit.Entries[0].Actor == "" || audit.Entries[0].Actor == "anonymous" {
		t.Fatalf("unexpected audit entry: %+v", audit.Entries[0])
	}

	// A failed login is audited too, so brute force is visible.
	_, _ = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/auth/login", "", map[string]string{
		"email": testOwnerEmail, "password": "wrong",
	})
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/audit?action=admin.login&result=error", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("read login audit status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &audit)
	if audit.Total < 1 {
		t.Fatalf("expected failed-login audit entry, got %+v", audit)
	}
}

func TestAdminRequiresAuthentication(t *testing.T) {
	environment := newAdminEnvironment(t)
	for _, path := range []string{"/v1/admin/overview", "/v1/admin/users", "/v1/admin/devices", "/v1/admin/audit", "/v1/admin/auth/me"} {
		status, body := testRequest(t, http.MethodGet, environment.http.URL+path, "", nil)
		assertErrorResponse(t, status, body, http.StatusUnauthorized, "unauthorized")
		status, body = testRequest(t, http.MethodGet, environment.http.URL+path, "garbage-token", nil)
		assertErrorResponse(t, status, body, http.StatusUnauthorized, "unauthorized")
	}
}

func TestAdminPairingCodeLifecycle(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/pairing-codes", ownerToken, nil)
	if status != http.StatusCreated {
		t.Fatalf("create pairing code status=%d body=%s", status, body)
	}
	var created createPairingCodeResponse
	decodeTestJSON(t, body, &created)
	if created.Code == "" || created.ServerURL == "" || created.ExpiresAt.IsZero() {
		t.Fatalf("unexpected pairing code response: %+v", created)
	}

	// The plaintext code must not be persisted anywhere.
	if dumped := dumpTable(t, environment.databaseURL, "pairing_codes"); bytes.Contains([]byte(dumped), []byte(created.Code)) {
		t.Fatal("plaintext pairing code was persisted")
	}

	// A Connector can consume the code issued by the Web Admin.
	connection := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", "")
	t.Cleanup(func() { _ = connection.Close(websocket.StatusNormalClosure, "test complete") })
	writeTestFrame(t, connection, protocol.PairStart{
		V: protocol.Version, Type: protocol.TypePairStart, RequestID: "pair-start-admin",
		PairingCode: created.Code, DeviceName: "Admin Issued Desktop", ConnectorVersion: "0.1.0",
	})
	challenge := readTestFrame[protocol.PairChallenge](t, connection)
	if challenge.Type != protocol.TypePairChallenge || challenge.DeviceID == "" {
		t.Fatalf("pairing code from admin API was not accepted: %+v", challenge)
	}

	// Consuming a code only starts the challenge. It must not be presented as a
	// completed pairing while the desktop user is still choosing workspace grants.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/pairing-codes", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("list pairing codes status=%d body=%s", status, body)
	}
	if bytes.Contains(body, []byte(created.Code)) {
		t.Fatal("pairing code listing leaked the plaintext code")
	}
	var listed pairingCodeListResponse
	decodeTestJSON(t, body, &listed)
	if len(listed.Codes) != 1 || listed.Codes[0].State != "waiting_desktop_authorization" || listed.Codes[0].DeviceID == "" {
		t.Fatalf("unexpected waiting pairing code listing: %+v", listed.Codes)
	}

	writeTestFrame(t, connection, protocol.PairAuthorize{
		V: protocol.Version, Type: protocol.TypePairAuthorize, RequestID: "pair-authorize-admin",
		PairingToken: challenge.PairingToken,
		Workspaces:   []protocol.Workspace{{ID: "ws-admin", Name: "Admin Project", Path: "/tmp/admin-project"}},
		Scopes:       []string{"read"},
	})
	complete := readTestFrame[protocol.PairComplete](t, connection)
	if complete.Type != protocol.TypePairComplete || complete.DeviceID != challenge.DeviceID || complete.DeviceToken == "" {
		t.Fatalf("desktop authorization did not complete pairing: %+v", complete)
	}
	deviceRecord, err := environment.server.store.Device(context.Background(), challenge.DeviceID)
	if err != nil || len(deviceRecord.Device.Workspaces) != 1 || deviceRecord.Device.Workspaces[0].ID != "ws-admin" {
		t.Fatalf("authorized workspace was not persisted: record=%+v err=%v", deviceRecord, err)
	}

	// Only explicit desktop authorization advances the lifecycle to used/complete.
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/pairing-codes", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("list completed pairing codes status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &listed)
	if len(listed.Codes) != 1 || listed.Codes[0].State != "used" || listed.Codes[0].DeviceID != challenge.DeviceID {
		t.Fatalf("unexpected completed pairing code listing: %+v", listed.Codes)
	}

	// Reusing the consumed code must fail.
	second := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", "")
	t.Cleanup(func() { _ = second.Close(websocket.StatusNormalClosure, "test complete") })
	writeTestFrame(t, second, protocol.PairStart{
		V: protocol.Version, Type: protocol.TypePairStart, RequestID: "pair-start-reuse",
		PairingCode: created.Code, DeviceName: "Replay Desktop", ConnectorVersion: "0.1.0",
	})
	errorEnvelope := readTestFrame[protocol.ErrorEnvelope](t, second)
	if errorEnvelope.Error.Code != protocol.CodePairingCodeUsed {
		t.Fatalf("reused pairing code error=%q; want %q", errorEnvelope.Error.Code, protocol.CodePairingCodeUsed)
	}
}

func TestAdminPairingCodePermissions(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": "member3@example.com", "displayName": "Member", "password": "member-password", "role": store.RoleMember,
	})
	if status != http.StatusCreated {
		t.Fatalf("create member status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": "auditor2@example.com", "displayName": "Auditor", "password": "auditor-password", "role": store.RoleAuditor,
	})
	if status != http.StatusCreated {
		t.Fatalf("create auditor status=%d body=%s", status, body)
	}
	memberToken, _ := environment.login(t, "member3@example.com", "member-password")
	auditorToken, _ := environment.login(t, "auditor2@example.com", "auditor-password")

	// Members cannot issue pairing codes: that would grant desktop access.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/pairing-codes", memberToken, nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, "forbidden")

	// Auditors may observe but never mint a code.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/pairing-codes", auditorToken, nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, "forbidden")
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/pairing-codes", auditorToken, nil)
	if status != http.StatusOK {
		t.Fatalf("auditor list pairing codes status=%d body=%s", status, body)
	}

	// Issuing a code is audited with the real operator.
	issued, issuedBody := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/pairing-codes", ownerToken, nil)
	if issued != http.StatusCreated {
		t.Fatalf("owner create pairing code status=%d body=%s", issued, issuedBody)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/audit?action=admin.pairing_code.create", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("read audit status=%d body=%s", status, body)
	}
	var audit auditListResponse
	decodeTestJSON(t, body, &audit)
	if audit.Total < 1 || audit.Entries[0].Actor == "anonymous" {
		t.Fatalf("pairing code creation was not audited: %+v", audit.Entries)
	}
}

func TestAdminOverviewCounts(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	pairConnector(t, environment.testEnvironment)

	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/overview", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("overview status=%d body=%s", status, body)
	}
	var overview overviewResponse
	decodeTestJSON(t, body, &overview)
	if overview.Devices["total"] != 1 || overview.Devices["online"] != 1 {
		t.Fatalf("unexpected device counts: %+v", overview.Devices)
	}
	if overview.Users["total"] != 1 || overview.Users["active"] != 1 {
		t.Fatalf("unexpected user counts: %+v", overview.Users)
	}
	if overview.Audit < 1 || len(overview.Recent) == 0 {
		t.Fatalf("unexpected audit summary: %+v", overview)
	}
}

// dumpTable returns every row of a table as text, for secret-leak assertions.
func dumpTable(t *testing.T, dsn, table string) string {
	t.Helper()
	db := openTestDB(t, dsn)
	defer db.Close()
	rows, err := db.QueryContext(context.Background(),
		fmt.Sprintf(`SELECT coalesce(string_agg(t::text, ' '), '') FROM %s t`, table))
	if err != nil {
		t.Fatalf("dump %s: %v", table, err)
	}
	defer rows.Close()
	var dumped string
	if rows.Next() {
		if err := rows.Scan(&dumped); err != nil {
			t.Fatalf("scan %s: %v", table, err)
		}
	}
	return dumped
}

// waitClosed blocks until the Connector observes the server closing the socket.
func waitClosed(t *testing.T, connection *websocket.Conn) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		_, _, err := connection.Read(ctx)
		cancel()
		if err != nil {
			return
		}
	}
	t.Fatal("Connector connection was not closed by the server")
}

// assertUpgradeRejected proves a credential no longer opens the Connector
// channel: the upgrade must be refused with 401.
func assertUpgradeRejected(t *testing.T, baseURL, deviceToken string) {
	t.Helper()
	header := http.Header{}
	if deviceToken != "" {
		header.Set("Authorization", "Bearer "+deviceToken)
	}
	connection, response, err := websocket.Dial(
		context.Background(),
		"ws"+baseURL[len("http"):]+"/v1/connector/ws",
		&websocket.DialOptions{HTTPHeader: header},
	)
	if err == nil {
		_ = connection.Close(websocket.StatusNormalClosure, "cleanup")
		t.Fatal("revoked device token was accepted")
	}
	if response == nil || response.StatusCode != http.StatusUnauthorized {
		status := 0
		if response != nil {
			status = response.StatusCode
		}
		t.Fatalf("upgrade status=%d; want 401", status)
	}
}

// openTestDB opens a direct database connection for assertions.
func openTestDB(t *testing.T, dsn string) *sql.DB {
	t.Helper()
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	return db
}
