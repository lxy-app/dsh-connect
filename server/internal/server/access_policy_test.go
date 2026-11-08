package server

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

func TestAdminAccessPolicyCRUDAndPermissions(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnectorWithScopes(t, environment.testEnvironment, []string{"read", "prompt"})
	member := createAccessPolicyTestUser(t, environment, ownerToken, "policy-member@example.com", store.RoleMember)
	admin := createAccessPolicyTestUser(t, environment, ownerToken, "policy-admin@example.com", store.RoleAdmin)
	auditor := createAccessPolicyTestUser(t, environment, ownerToken, "policy-auditor@example.com", store.RoleAuditor)
	adminToken, _ := environment.login(t, admin.Email, "policy-test-password")
	auditorToken, _ := environment.login(t, auditor.Email, "policy-test-password")
	memberToken, _ := environment.login(t, member.Email, "policy-test-password")

	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/policies", auditorToken, nil)
	if status != http.StatusOK {
		t.Fatalf("empty policy list status=%d body=%s", status, body)
	}
	var listed accessPolicyListResponse
	decodeTestJSON(t, body, &listed)
	if listed.Policies == nil || len(listed.Policies) != 0 {
		t.Fatalf("empty policy list was not a JSON array: %+v", listed.Policies)
	}

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/policies", memberToken, nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/policies", auditorToken, map[string]any{
		"name": "Forbidden", "memberIds": []string{}, "rules": []store.AccessPolicyRule{},
	})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/policies", adminToken, map[string]any{
		"name": "Mobile team", "description": "Initial description", "memberIds": []string{member.ID},
		"rules": []store.AccessPolicyRule{{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read"}}},
	})
	if status != http.StatusCreated {
		t.Fatalf("create policy status=%d body=%s", status, body)
	}
	var created store.AccessPolicyRecord
	decodeTestJSON(t, body, &created)
	if created.PolicyID == "" || created.Revision != 1 || !created.Enabled || created.Name != "Mobile team" ||
		len(created.MemberIDs) != 1 || created.MemberIDs[0] != member.ID || len(created.Rules) != 1 || created.CreatedAt.IsZero() {
		t.Fatalf("unexpected created policy: %+v", created)
	}

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/policies", auditorToken, nil)
	decodeTestJSON(t, body, &listed)
	if status != http.StatusOK || len(listed.Policies) != 1 || listed.Policies[0].PolicyID != created.PolicyID {
		t.Fatalf("auditor policy list status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/users/"+member.ID+"/access-preview", auditorToken, nil)
	if status != http.StatusOK {
		t.Fatalf("auditor access preview status=%d body=%s", status, body)
	}

	policyURL := environment.http.URL + "/v1/admin/policies/" + created.PolicyID
	status, body = testRequest(t, http.MethodPatch, policyURL, auditorToken, map[string]any{"revision": created.Revision, "name": "Forbidden"})
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)
	status, body = testRequest(t, http.MethodDelete, fmt.Sprintf("%s?revision=%d", policyURL, created.Revision), auditorToken, nil)
	assertErrorResponse(t, status, body, http.StatusForbidden, protocol.CodeForbidden)

	status, body = testRequest(t, http.MethodPatch, policyURL, adminToken, map[string]any{
		"revision": created.Revision, "name": "Renamed team", "description": "Updated description",
	})
	if status != http.StatusOK {
		t.Fatalf("rename policy status=%d body=%s", status, body)
	}
	var updated store.AccessPolicyRecord
	decodeTestJSON(t, body, &updated)
	if updated.Revision != 2 || updated.Name != "Renamed team" || updated.Description != "Updated description" || !updated.Enabled {
		t.Fatalf("unexpected renamed policy: %+v", updated)
	}

	status, body = testRequest(t, http.MethodPatch, policyURL, adminToken, map[string]any{
		"revision": updated.Revision, "memberIds": []string{member.ID, ownerID},
		"rules": []store.AccessPolicyRule{{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read", "prompt"}}},
	})
	if status != http.StatusOK {
		t.Fatalf("change policy access status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &updated)
	if updated.Revision != 3 || len(updated.MemberIDs) != 2 || len(updated.Rules[0].Scopes) != 2 {
		t.Fatalf("policy access was not changed: %+v", updated)
	}

	status, body = testRequest(t, http.MethodPatch, policyURL, adminToken, map[string]any{"revision": 1, "enabled": false})
	assertErrorResponse(t, status, body, http.StatusConflict, protocol.CodeConflict)
	status, body = testRequest(t, http.MethodPatch, policyURL, ownerToken, map[string]any{"revision": updated.Revision, "enabled": false})
	if status != http.StatusOK {
		t.Fatalf("disable policy status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &updated)
	if updated.Revision != 4 || updated.Enabled {
		t.Fatalf("policy was not disabled: %+v", updated)
	}

	status, body = testRequest(t, http.MethodDelete, policyURL, ownerToken, nil)
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)
	status, body = testRequest(t, http.MethodDelete, policyURL+"?revision=2", ownerToken, nil)
	assertErrorResponse(t, status, body, http.StatusConflict, protocol.CodeConflict)
	status, body = testRequest(t, http.MethodDelete, policyURL+"?revision=4", ownerToken, nil)
	if status != http.StatusNoContent {
		t.Fatalf("delete policy status=%d body=%s", status, body)
	}
	status, body = testRequest(t, http.MethodDelete, policyURL+"?revision=4", ownerToken, nil)
	assertErrorResponse(t, status, body, http.StatusNotFound, protocol.CodeNotFound)
	status, body = testRequest(t, http.MethodPatch, policyURL, ownerToken, map[string]any{"revision": 4, "name": "Missing"})
	assertErrorResponse(t, status, body, http.StatusNotFound, protocol.CodeNotFound)

	secrets := []string{testOwnerPassword, "policy-test-password", connector.deviceToken}
	createdAudits := readAccessPolicyAuditSnapshots(t, environment, ownerToken, "admin.policy.create", secrets...)
	if len(createdAudits) != 1 || createdAudits[0].Before != nil || createdAudits[0].After == nil {
		t.Fatalf("unexpected create audit snapshots: %+v", createdAudits)
	}
	createdAfter := createdAudits[0].After
	if createdAfter.PolicyID != created.PolicyID || createdAfter.Revision != 1 || len(createdAfter.MemberIDs) != 1 ||
		len(createdAfter.Rules) != 1 || !reflect.DeepEqual(createdAfter.Rules[0].Scopes, []string{"read"}) {
		t.Fatalf("unexpected create audit after snapshot: %+v", createdAfter)
	}

	updateAudits := readAccessPolicyAuditSnapshots(t, environment, ownerToken, "admin.policy.update", secrets...)
	if len(updateAudits) != 3 {
		t.Fatalf("successful update audit count=%d; want 3", len(updateAudits))
	}
	var accessChangeAudit *accessPolicyAuditSnapshot
	for index := range updateAudits {
		snapshot := &updateAudits[index]
		if snapshot.Before == nil || snapshot.After == nil {
			t.Fatalf("update audit omitted before/after: %+v", snapshot)
		}
		if snapshot.After.Revision == 3 {
			accessChangeAudit = snapshot
		}
	}
	if accessChangeAudit == nil || accessChangeAudit.Before.Revision != 2 || accessChangeAudit.After.Revision != 3 ||
		len(accessChangeAudit.Before.MemberIDs) != 1 || len(accessChangeAudit.After.MemberIDs) != 2 ||
		!reflect.DeepEqual(accessChangeAudit.Before.Rules[0].Scopes, []string{"read"}) ||
		!reflect.DeepEqual(accessChangeAudit.After.Rules[0].Scopes, []string{"read", "prompt"}) {
		t.Fatalf("update audit did not capture access/revision changes: %+v", accessChangeAudit)
	}

	deleteAudits := readAccessPolicyAuditSnapshots(t, environment, ownerToken, "admin.policy.delete", secrets...)
	if len(deleteAudits) != 1 || deleteAudits[0].Before == nil || deleteAudits[0].After != nil {
		t.Fatalf("unexpected delete audit snapshots: %+v", deleteAudits)
	}
	deleteBefore := deleteAudits[0].Before
	if deleteBefore.PolicyID != created.PolicyID || deleteBefore.Revision != 4 || len(deleteBefore.MemberIDs) != 2 ||
		len(deleteBefore.Rules) != 1 || !reflect.DeepEqual(deleteBefore.Rules[0].Scopes, []string{"read", "prompt"}) {
		t.Fatalf("unexpected delete audit before snapshot: %+v", deleteBefore)
	}

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/users/"+ownerID+"/access-preview", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("owner without policy preview status=%d body=%s", status, body)
	}
}

func TestAdminAccessPolicyValidation(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnectorWithScopes(t, environment.testEnvironment, []string{"read"})
	member := createAccessPolicyTestUser(t, environment, ownerToken, "policy-validation-member@example.com", store.RoleMember)
	validPayload := func() map[string]any {
		return map[string]any{
			"name": "Validation policy", "description": "valid", "enabled": true, "memberIds": []string{member.ID},
			"rules": []store.AccessPolicyRule{{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read"}}},
		}
	}
	cases := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "unknown JSON field", mutate: func(payload map[string]any) { payload["unexpected"] = true }},
		{name: "empty name", mutate: func(payload map[string]any) { payload["name"] = "" }},
		{name: "unknown member", mutate: func(payload map[string]any) { payload["memberIds"] = []string{"usr_missing"} }},
		{name: "invalid member", mutate: func(payload map[string]any) { payload["memberIds"] = []string{"bad\nuser"} }},
		{name: "unknown device", mutate: func(payload map[string]any) {
			payload["rules"] = []store.AccessPolicyRule{{DeviceID: "dev_missing", WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read"}}}
		}},
		{name: "duplicate device", mutate: func(payload map[string]any) {
			payload["rules"] = []store.AccessPolicyRule{
				{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read"}},
				{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read"}},
			}
		}},
		{name: "empty workspaces", mutate: func(payload map[string]any) {
			payload["rules"] = []store.AccessPolicyRule{{DeviceID: connector.deviceID, WorkspaceIDs: []string{}, Scopes: []string{"read"}}}
		}},
		{name: "empty scopes", mutate: func(payload map[string]any) {
			payload["rules"] = []store.AccessPolicyRule{{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{}}}
		}},
		{name: "unknown workspace", mutate: func(payload map[string]any) {
			payload["rules"] = []store.AccessPolicyRule{{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws_missing"}, Scopes: []string{"read"}}}
		}},
		{name: "unsupported scope", mutate: func(payload map[string]any) {
			payload["rules"] = []store.AccessPolicyRule{{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"admin"}}}
		}},
		{name: "scope not open on desktop", mutate: func(payload map[string]any) {
			payload["rules"] = []store.AccessPolicyRule{{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"prompt"}}}
		}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			payload := validPayload()
			test.mutate(payload)
			status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/policies", ownerToken, payload)
			assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)
		})
	}

	// Empty members and rules are valid: the policy grants no access until
	// permissions are assigned, rather than implicitly granting everything.
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/policies", ownerToken, map[string]any{
		"name": "Empty policy", "memberIds": []string{}, "rules": []store.AccessPolicyRule{},
	})
	if status != http.StatusCreated {
		t.Fatalf("empty policy status=%d body=%s", status, body)
	}
	var empty store.AccessPolicyRecord
	decodeTestJSON(t, body, &empty)
	if empty.MemberIDs == nil || empty.Rules == nil || len(empty.MemberIDs) != 0 || len(empty.Rules) != 0 {
		t.Fatalf("empty policy arrays were not preserved: %+v", empty)
	}

	duplicate := validPayload()
	duplicate["name"] = empty.Name
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/policies", ownerToken, duplicate)
	assertErrorResponse(t, status, body, http.StatusConflict, protocol.CodeConflict)

	policyURL := environment.http.URL + "/v1/admin/policies/" + empty.PolicyID
	status, body = testRequest(t, http.MethodPatch, policyURL, ownerToken, map[string]any{"revision": 1, "unknown": true})
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)
	status, body = testRequest(t, http.MethodPatch, policyURL, ownerToken, map[string]any{"revision": 0, "name": "Invalid"})
	assertErrorResponse(t, status, body, http.StatusBadRequest, protocol.CodeInvalidRequest)
}

func TestAdminAccessPolicyChangesCloseOldAndNewMemberStreams(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnectorWithScopes(t, environment.testEnvironment, []string{"read", "prompt"})
	oldMember := createAccessPolicyTestUser(t, environment, ownerToken, "policy-old-member@example.com", store.RoleMember)
	newMember := createAccessPolicyTestUser(t, environment, ownerToken, "policy-new-member@example.com", store.RoleMember)
	created := createAccessPolicyForTest(t, environment, ownerToken, "Stream policy", []string{oldMember.ID}, []store.AccessPolicyRule{
		{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read"}},
	})
	policyURL := environment.http.URL + "/v1/admin/policies/" + created.PolicyID

	oldStream := subscribeAccessPolicyTestUser(t, environment.server.events, oldMember.ID)
	unrelatedStream := subscribeAccessPolicyTestUser(t, environment.server.events, ownerID)
	status, body := testRequest(t, http.MethodPatch, policyURL, ownerToken, map[string]any{
		"revision": created.Revision, "name": "Metadata only", "description": "No permission change",
	})
	if status != http.StatusOK {
		t.Fatalf("metadata update status=%d body=%s", status, body)
	}
	var updated store.AccessPolicyRecord
	decodeTestJSON(t, body, &updated)
	assertAccessPolicyStreamOpen(t, oldStream, "metadata update")

	oldStream = subscribeAccessPolicyTestUser(t, environment.server.events, oldMember.ID)
	status, body = testRequest(t, http.MethodPatch, policyURL, ownerToken, map[string]any{
		"revision": updated.Revision,
		"rules":    []store.AccessPolicyRule{{DeviceID: connector.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read", "prompt"}}},
	})
	if status != http.StatusOK {
		t.Fatalf("rules update status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &updated)
	assertAccessPolicyStreamClosed(t, oldStream, "rules update")

	oldStream = subscribeAccessPolicyTestUser(t, environment.server.events, oldMember.ID)
	status, body = testRequest(t, http.MethodPatch, policyURL, ownerToken, map[string]any{"revision": updated.Revision, "enabled": false})
	if status != http.StatusOK {
		t.Fatalf("enabled update status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &updated)
	assertAccessPolicyStreamClosed(t, oldStream, "enabled update")

	oldStream = subscribeAccessPolicyTestUser(t, environment.server.events, oldMember.ID)
	newStream := subscribeAccessPolicyTestUser(t, environment.server.events, newMember.ID)
	status, body = testRequest(t, http.MethodPatch, policyURL, ownerToken, map[string]any{"revision": updated.Revision, "memberIds": []string{newMember.ID}})
	if status != http.StatusOK {
		t.Fatalf("member update status=%d body=%s", status, body)
	}
	decodeTestJSON(t, body, &updated)
	assertAccessPolicyStreamClosed(t, oldStream, "old member update")
	assertAccessPolicyStreamClosed(t, newStream, "new member update")
	assertAccessPolicyStreamOpen(t, unrelatedStream, "another user's policy update")

	newStream = subscribeAccessPolicyTestUser(t, environment.server.events, newMember.ID)
	status, body = testRequest(t, http.MethodDelete, fmt.Sprintf("%s?revision=%d", policyURL, updated.Revision), ownerToken, nil)
	if status != http.StatusNoContent {
		t.Fatalf("delete policy status=%d body=%s", status, body)
	}
	assertAccessPolicyStreamClosed(t, newStream, "policy deletion")
	assertAccessPolicyStreamOpen(t, unrelatedStream, "policy deletion")
}

func TestPolicyAccessPreviewAndResolver(t *testing.T) {
	environment := newAdminEnvironment(t)
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)
	member := createAccessPolicyTestUser(t, environment, ownerToken, "policy-preview-member@example.com", store.RoleMember)
	other := createAccessPolicyTestUser(t, environment, ownerToken, "policy-preview-other@example.com", store.RoleMember)
	allScopes := []string{"read", "prompt", "approve", "cancel"}
	first := pairConnectorWithScopes(t, environment.testEnvironment, allScopes)
	second := pairConnectorWithScopes(t, environment.testEnvironment, allScopes)
	revoked := pairConnectorWithScopes(t, environment.testEnvironment, allScopes)
	firstWorkspaces := []protocol.Workspace{
		{ID: "ws-1", Name: "First project", Path: "/private/first-project"},
		{ID: "ws-2", Name: "Second project", Path: "/private/second-project"},
	}
	if _, err := environment.server.store.UpdateDeviceGrants(context.Background(), first.deviceID, firstWorkspaces, allScopes, nowUTC()); err != nil {
		t.Fatalf("expand first desktop grants: %v", err)
	}
	if err := environment.server.store.RevokeDevice(context.Background(), revoked.deviceID, nowUTC()); err != nil {
		t.Fatalf("revoke desktop: %v", err)
	}

	// A waiting desktop can retain stale grant metadata; it must still be hidden.
	waitingCode := createPairingCode(t, environment.testEnvironment)
	waitingConnection := dialWebSocket(t, environment.http.URL, "/v1/connector/ws", "")
	t.Cleanup(func() { _ = waitingConnection.Close(websocket.StatusNormalClosure, "test complete") })
	writeTestFrame(t, waitingConnection, protocol.PairStart{
		V: protocol.Version, Type: protocol.TypePairStart, RequestID: "policy-preview-waiting", PairingCode: waitingCode.Code, DeviceName: "Waiting desktop", ConnectorVersion: "0.1.0",
	})
	waitingChallenge := readTestFrame[protocol.PairChallenge](t, waitingConnection)
	if _, err := environment.server.store.UpdateDeviceGrants(context.Background(), waitingChallenge.DeviceID, []protocol.Workspace{
		{ID: "ws-waiting", Name: "Waiting workspace", Path: "/private/waiting"},
	}, allScopes, nowUTC()); err != nil {
		t.Fatalf("set waiting desktop grants: %v", err)
	}

	firstPolicy := createAccessPolicyForTest(t, environment, ownerToken, "Preview base", []string{member.ID}, []store.AccessPolicyRule{
		{DeviceID: first.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read", "prompt"}},
		{DeviceID: revoked.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read"}},
		{DeviceID: waitingChallenge.DeviceID, WorkspaceIDs: []string{"ws-waiting"}, Scopes: []string{"read"}},
	})
	secondPolicy := createAccessPolicyForTest(t, environment, ownerToken, "Preview union", []string{member.ID}, []store.AccessPolicyRule{
		{DeviceID: first.deviceID, WorkspaceIDs: []string{"ws-1", "ws-2"}, Scopes: []string{"read", "cancel"}},
		{DeviceID: second.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read"}},
	})
	createAccessPolicyForTest(t, environment, ownerToken, "Preview disabled", []string{member.ID}, []store.AccessPolicyRule{
		{DeviceID: first.deviceID, WorkspaceIDs: []string{"ws-2"}, Scopes: []string{"approve"}},
	})
	createAccessPolicyForTest(t, environment, ownerToken, "Preview other member", []string{other.ID}, []store.AccessPolicyRule{
		{DeviceID: second.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"approve"}},
	})
	// Correct the second policy so ws-1 has read+cancel and ws-2 has approve,
	// demonstrating that unions are per workspace rather than per desktop.
	status, body := testRequest(t, http.MethodPatch, environment.http.URL+"/v1/admin/policies/"+secondPolicy.PolicyID, ownerToken, map[string]any{
		"revision": secondPolicy.Revision,
		"rules": []store.AccessPolicyRule{
			{DeviceID: first.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read", "cancel"}},
			{DeviceID: second.deviceID, WorkspaceIDs: []string{"ws-1"}, Scopes: []string{"read"}},
		},
	})
	if status != http.StatusOK {
		t.Fatalf("adjust union policy status=%d body=%s", status, body)
	}
	// Use a separate policy for ws-2/approve to keep one rule per device.
	thirdPolicy := createAccessPolicyForTest(t, environment, ownerToken, "Preview workspace two", []string{member.ID}, []store.AccessPolicyRule{
		{DeviceID: first.deviceID, WorkspaceIDs: []string{"ws-2"}, Scopes: []string{"approve"}},
	})

	access, err := environment.server.policyAccessForUser(context.Background(), member.ID)
	if err != nil {
		t.Fatalf("resolve policy access: %v", err)
	}
	if !access.allows(first.deviceID, "ws-1", "prompt") || !access.allows(first.deviceID, "ws-1", "cancel") ||
		!access.allows(first.deviceID, "ws-2", "approve") || access.allows(first.deviceID, "ws-2", "read") ||
		access.allows(second.deviceID, "ws-1", "approve") || access.allows("dev_missing", "ws-1", "read") {
		t.Fatal("policy resolver did not apply per-workspace unions and default denial")
	}
	if !access.allowsRequest(first.deviceID, []string{"ws-1"}, []string{"read", "prompt"}) ||
		access.allowsRequest(first.deviceID, []string{"ws-1", "ws-2"}, []string{"read"}) ||
		access.allowsRequest(first.deviceID, nil, []string{"read"}) || access.allowsRequest(first.deviceID, []string{"ws-1"}, nil) {
		t.Fatal("allowsRequest accepted an ungranted or empty request")
	}
	if got := access.scopes(first.deviceID, "ws-1"); !reflect.DeepEqual(got, []string{"read", "prompt", "cancel"}) {
		t.Fatalf("workspace scopes=%v", got)
	}
	if got := access.workspaceScopes(first.deviceID); len(got) != 2 {
		t.Fatalf("workspace scope projection=%v", got)
	}

	// Desktop grants are an independent upper bound. Removing approve/cancel
	// immediately narrows preview scopes without rewriting policy rows.
	if _, err := environment.server.store.UpdateDeviceGrants(context.Background(), first.deviceID, firstWorkspaces, []string{"read", "prompt"}, nowUTC()); err != nil {
		t.Fatalf("narrow first desktop grants: %v", err)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/users/"+member.ID+"/access-preview", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("access preview status=%d body=%s", status, body)
	}
	if bytes.Contains(body, []byte(`"path"`)) || bytes.Contains(body, []byte("/private/")) {
		t.Fatalf("access preview leaked workspace paths: %s", body)
	}
	var preview accessPreviewResponse
	decodeTestJSON(t, body, &preview)
	expectedPolicyIDs := []string{firstPolicy.PolicyID, secondPolicy.PolicyID, thirdPolicy.PolicyID}
	sort.Strings(expectedPolicyIDs)
	if preview.UserID != member.ID || !reflect.DeepEqual(preview.PolicyIDs, expectedPolicyIDs) || len(preview.Desktops) != 2 {
		t.Fatalf("unexpected access preview identity/policies/desktops: %+v", preview)
	}
	firstPreview := accessPolicyPreviewDesktop(preview, first.deviceID)
	if firstPreview == nil || !firstPreview.Online || len(firstPreview.Workspaces) != 2 {
		t.Fatalf("first desktop preview=%+v", firstPreview)
	}
	if !reflect.DeepEqual(firstPreview.Scopes, []string{"read", "prompt"}) {
		t.Fatalf("first desktop effective scopes=%v", firstPreview.Scopes)
	}
	if got := firstPreview.Workspaces[0].Scopes; !reflect.DeepEqual(got, []string{"read", "prompt"}) {
		t.Fatalf("first workspace effective scopes=%v", got)
	}
	if firstPreview.Workspaces[1].ID != "ws-2" || firstPreview.Workspaces[1].Scopes == nil || len(firstPreview.Workspaces[1].Scopes) != 0 {
		t.Fatalf("second workspace should remain visible with no effective scopes: %+v", firstPreview.Workspaces[1])
	}
	secondPreview := accessPolicyPreviewDesktop(preview, second.deviceID)
	if secondPreview == nil || len(secondPreview.Workspaces) != 1 || !reflect.DeepEqual(secondPreview.Workspaces[0].Scopes, []string{"read"}) {
		t.Fatalf("second desktop preview=%+v", secondPreview)
	}
	if accessPolicyPreviewDesktop(preview, revoked.deviceID) != nil || accessPolicyPreviewDesktop(preview, waitingChallenge.DeviceID) != nil {
		t.Fatal("revoked or waiting desktop appeared in access preview")
	}

	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/users/"+ownerID+"/access-preview", ownerToken, nil)
	if status != http.StatusOK {
		t.Fatalf("empty owner preview status=%d body=%s", status, body)
	}
	var emptyPreview accessPreviewResponse
	decodeTestJSON(t, body, &emptyPreview)
	if emptyPreview.PolicyIDs == nil || emptyPreview.Desktops == nil || len(emptyPreview.PolicyIDs) != 0 || len(emptyPreview.Desktops) != 0 {
		t.Fatalf("owner without policies received access: %+v", emptyPreview)
	}
	status, body = testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/users/usr_missing/access-preview", ownerToken, nil)
	assertErrorResponse(t, status, body, http.StatusNotFound, protocol.CodeNotFound)
}

type accessPolicyAuditSnapshot struct {
	Before *store.AccessPolicyRecord `json:"before"`
	After  *store.AccessPolicyRecord `json:"after"`
}

func readAccessPolicyAuditSnapshots(t *testing.T, environment *adminEnvironment, token, action string, secrets ...string) []accessPolicyAuditSnapshot {
	t.Helper()
	status, body := testRequest(t, http.MethodGet, environment.http.URL+"/v1/admin/audit?action="+action, token, nil)
	if status != http.StatusOK {
		t.Fatalf("read %s audit status=%d body=%s", action, status, body)
	}
	var response auditListResponse
	decodeTestJSON(t, body, &response)
	if response.Total == 0 || len(response.Entries) == 0 {
		t.Fatalf("missing %s audit entries", action)
	}
	snapshots := make([]accessPolicyAuditSnapshot, 0, len(response.Entries))
	for _, entry := range response.Entries {
		if entry.Result != "success" || len(entry.Details) == 0 {
			t.Fatalf("audit entry missing success details: %+v", entry)
		}
		for _, secret := range secrets {
			if secret != "" && bytes.Contains(entry.Details, []byte(secret)) {
				t.Fatalf("audit details leaked secret: %s", entry.Details)
			}
		}
		for _, forbiddenKey := range []string{`"password"`, `"passwordHash"`, `"deviceToken"`, `"accessToken"`, `"refreshToken"`, `"tokenHash"`} {
			if bytes.Contains(entry.Details, []byte(forbiddenKey)) {
				t.Fatalf("audit details contain secret field %s: %s", forbiddenKey, entry.Details)
			}
		}
		var snapshot accessPolicyAuditSnapshot
		decodeTestJSON(t, entry.Details, &snapshot)
		snapshots = append(snapshots, snapshot)
	}
	return snapshots
}

func createAccessPolicyTestUser(t *testing.T, environment *adminEnvironment, ownerToken, email, role string) store.User {
	t.Helper()
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/users", ownerToken, map[string]string{
		"email": email, "displayName": strings.Split(email, "@")[0], "password": "policy-test-password", "role": role,
	})
	if status != http.StatusCreated {
		t.Fatalf("create policy test user status=%d body=%s", status, body)
	}
	var user store.User
	decodeTestJSON(t, body, &user)
	return user
}

func createAccessPolicyForTest(t *testing.T, environment *adminEnvironment, token, name string, memberIDs []string, rules []store.AccessPolicyRule) store.AccessPolicyRecord {
	t.Helper()
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/admin/policies", token, map[string]any{
		"name": name, "description": name + " description", "enabled": name != "Preview disabled", "memberIds": memberIDs, "rules": rules,
	})
	if status != http.StatusCreated {
		t.Fatalf("create policy %q status=%d body=%s", name, status, body)
	}
	var policy store.AccessPolicyRecord
	decodeTestJSON(t, body, &policy)
	return policy
}

func subscribeAccessPolicyTestUser(t *testing.T, events *EventHub, userID string) *subscription {
	t.Helper()
	stream, ok := events.SubscribeMobile("dev-policy-test", "session-"+userID, "mobile-"+userID, userID)
	if !ok {
		t.Fatalf("subscribe user %s", userID)
	}
	return stream
}

func assertAccessPolicyStreamClosed(t *testing.T, stream *subscription, action string) {
	t.Helper()
	select {
	case <-stream.done:
		if stream.reason.Code != protocol.CodeUnauthorized {
			t.Fatalf("%s close reason=%+v", action, stream.reason)
		}
	default:
		t.Fatalf("%s left member stream open", action)
	}
}

func assertAccessPolicyStreamOpen(t *testing.T, stream *subscription, action string) {
	t.Helper()
	select {
	case <-stream.done:
		t.Fatalf("%s unexpectedly closed stream", action)
	default:
	}
}

func accessPolicyPreviewDesktop(preview accessPreviewResponse, deviceID string) *accessPreviewDesktop {
	for index := range preview.Desktops {
		if preview.Desktops[index].DeviceID == deviceID {
			return &preview.Desktops[index]
		}
	}
	return nil
}
