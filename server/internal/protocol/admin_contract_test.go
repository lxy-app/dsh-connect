package protocol_test

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

type openAPISpec struct {
	Paths map[string]map[string]yaml.Node `yaml:"paths"`
}

type operationSpec struct {
	OperationID string                  `yaml:"operationId"`
	Description string                  `yaml:"description"`
	Parameters  []parameterSpec         `yaml:"parameters"`
	RequestBody *requestBodySpec        `yaml:"requestBody"`
	Responses   map[string]responseSpec `yaml:"responses"`
}

type requestBodySpec struct {
	Required bool                   `yaml:"required"`
	Content  map[string]contentSpec `yaml:"content"`
}

type responseSpec struct {
	Description string                 `yaml:"description"`
	Content     map[string]contentSpec `yaml:"content"`
}

type contentSpec struct {
	Schema struct {
		Ref string `yaml:"$ref"`
	} `yaml:"schema"`
}

type parameterSpec struct {
	Name     string `yaml:"name"`
	In       string `yaml:"in"`
	Required bool   `yaml:"required"`
	Schema   struct {
		Type    string `yaml:"type"`
		Default string `yaml:"default"`
	} `yaml:"schema"`
}

type jsonSchemaDefinition struct {
	Required             []string                   `json:"required"`
	Properties           map[string]json.RawMessage `json:"properties"`
	AdditionalProperties *bool                      `json:"additionalProperties"`
}

type jsonSchema struct {
	Definitions map[string]jsonSchemaDefinition `json:"$defs"`
}

func TestAdminOpenAPIContractCoverage(t *testing.T) {
	raw, err := os.ReadFile("../../../protocol/openapi.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI: %v", err)
	}
	var spec openAPISpec
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse OpenAPI: %v", err)
	}
	expected := map[string][]string{
		"/v1/admin/auth/login":                    {"post"},
		"/v1/admin/auth/logout":                   {"post"},
		"/v1/admin/auth/me":                       {"get"},
		"/v1/admin/overview":                      {"get"},
		"/v1/admin/sessions":                      {"get"},
		"/v1/admin/interactions":                  {"get"},
		"/v1/admin/approval-policy":               {"get", "patch"},
		"/v1/admin/settings":                      {"get"},
		"/v1/admin/users":                         {"get", "post"},
		"/v1/admin/users/{userId}":                {"patch", "delete"},
		"/v1/admin/users/{userId}/access-preview": {"get"},
		"/v1/admin/devices":                       {"get"},
		"/v1/admin/devices/{deviceId}":            {"patch", "delete"},
		"/v1/admin/devices/{deviceId}/revoke":     {"post"},
		"/v1/admin/audit":                         {"get"},
		"/v1/admin/policies":                      {"get", "post"},
		"/v1/admin/policies/{policyId}":           {"patch", "delete"},
		"/v1/admin/pairing-codes":                 {"get", "post"},
	}
	operationIDs := make(map[string]struct{})
	for path, methods := range expected {
		for _, method := range methods {
			node, ok := spec.Paths[path][method]
			if !ok {
				t.Fatalf("missing Admin operation %s %s", method, path)
			}
			var operation operationSpec
			if err := node.Decode(&operation); err != nil || operation.OperationID == "" {
				t.Fatalf("invalid Admin operation %s %s: %v", method, path, err)
			}
			if _, duplicate := operationIDs[operation.OperationID]; duplicate {
				t.Fatalf("duplicate operationId %q", operation.OperationID)
			}
			operationIDs[operation.OperationID] = struct{}{}
		}
	}

	var deleteOperation operationSpec
	deleteNode := spec.Paths["/v1/admin/policies/{policyId}"]["delete"]
	if err := deleteNode.Decode(&deleteOperation); err != nil {
		t.Fatalf("decode policy delete operation: %v", err)
	}
	foundRevision := false
	for _, parameter := range deleteOperation.Parameters {
		if parameter.Name == "revision" && parameter.In == "query" && parameter.Required && parameter.Schema.Type == "integer" {
			foundRevision = true
		}
	}
	if !foundRevision {
		t.Fatal("DELETE /v1/admin/policies/{policyId} must require an integer revision query parameter")
	}

	var overviewOperation operationSpec
	overviewNode := spec.Paths["/v1/admin/overview"]["get"]
	if err := overviewNode.Decode(&overviewOperation); err != nil {
		t.Fatalf("decode overview operation: %v", err)
	}
	foundTimeZone := false
	for _, parameter := range overviewOperation.Parameters {
		if parameter.Name == "tz" && parameter.In == "query" && !parameter.Required &&
			parameter.Schema.Type == "string" && parameter.Schema.Default == "UTC" {
			foundTimeZone = true
		}
	}
	if !foundTimeZone {
		t.Fatal("GET /v1/admin/overview must accept an optional tz query parameter defaulting to UTC")
	}
}

func TestAdminSchemasDoNotExposeCredentials(t *testing.T) {
	schema := readAdminSchema(t)
	for _, definition := range []string{
		"AdminUser",
		"AdminDesktopPairingCodeState",
		"AccessPolicy",
		"AccessPolicyRule",
		"AccessPreviewResponse",
		"AccessPreviewDesktop",
		"AccessPreviewWorkspace",
		"AdminSessionMetadata",
		"AdminSessionListResponse",
		"AdminPendingRequest",
		"AdminPromptTrendPoint",
		"AdminOverviewResponse",
		"AdminInteractionListResponse",
		"ApprovalPolicy",
		"AdminRuntimeSettings",
	} {
		properties := requireDefinition(t, schema, definition).Properties
		for _, forbidden := range []string{
			"password", "passwordHash", "code", "codeHash", "token", "tokenHash",
			"deviceToken", "deviceTokenHash", "pairingToken", "pairingTokenHash", "path", "workspacePath",
			"messages", "content", "body", "transcript", "cwd", "operator", "reason", "questions", "answers",
		} {
			if _, exists := properties[forbidden]; exists {
				t.Fatalf("%s unexpectedly exposes %s", definition, forbidden)
			}
		}
	}
	for _, definition := range []string{"AdminDesktopPairingCodeResponse", "AdminDesktopPairingCodeState"} {
		if !contains(requireDefinition(t, schema, definition).Required, "pairingId") {
			t.Fatalf("%s must require pairingId", definition)
		}
	}
}

func TestAdminAccessPolicySchemas(t *testing.T) {
	schema := readAdminSchema(t)
	for _, definition := range []string{
		"AccessPolicyRule",
		"AccessPolicy",
		"AccessPolicyCreateRequest",
		"AccessPolicyUpdateRequest",
		"AccessPolicyListResponse",
		"AccessPreviewResponse",
		"AccessPreviewDesktop",
		"AccessPreviewWorkspace",
	} {
		definitionSchema := requireDefinition(t, schema, definition)
		if definitionSchema.AdditionalProperties == nil || *definitionSchema.AdditionalProperties {
			t.Fatalf("%s must reject unknown properties", definition)
		}
	}

	required := map[string][]string{
		"AccessPolicyRule":          {"deviceId", "workspaceIds", "scopes"},
		"AccessPolicy":              {"policyId", "name", "description", "enabled", "memberIds", "rules", "revision", "createdAt", "updatedAt"},
		"AccessPolicyCreateRequest": {"name"},
		"AccessPolicyUpdateRequest": {"revision"},
		"AccessPolicyListResponse":  {"policies"},
		"AccessPreviewResponse":     {"userId", "policyIds", "desktops"},
		"AccessPreviewDesktop":      {"deviceId", "deviceName", "online", "workspaces", "scopes"},
		"AccessPreviewWorkspace":    {"id", "name", "scopes"},
	}
	for definition, fields := range required {
		definitionSchema := requireDefinition(t, schema, definition)
		for _, field := range fields {
			if !contains(definitionSchema.Required, field) {
				t.Fatalf("%s must require %s", definition, field)
			}
			if _, exists := definitionSchema.Properties[field]; !exists {
				t.Fatalf("%s is missing property %s", definition, field)
			}
		}
	}
	if got := schema.Definitions["AccessPolicyCreateRequest"].Required; len(got) != 1 || got[0] != "name" {
		t.Fatalf("policy create required fields=%v; want only name", got)
	}
	if got := schema.Definitions["AccessPolicyUpdateRequest"].Required; len(got) != 1 || got[0] != "revision" {
		t.Fatalf("policy update required fields=%v; want only revision", got)
	}
	for _, field := range []string{"name", "description", "enabled", "memberIds", "rules"} {
		if _, exists := schema.Definitions["AccessPolicyUpdateRequest"].Properties[field]; !exists {
			t.Fatalf("AccessPolicyUpdateRequest is missing optional field %s", field)
		}
	}
	for _, definition := range []string{"AccessPolicy", "AccessPolicyUpdateRequest"} {
		var revision struct {
			Type   string `json:"type"`
			Format string `json:"format"`
		}
		if err := json.Unmarshal(schema.Definitions[definition].Properties["revision"], &revision); err != nil {
			t.Fatalf("decode %s revision: %v", definition, err)
		}
		if revision.Type != "integer" || revision.Format != "int64" {
			t.Fatalf("%s revision must be integer/int64, got %+v", definition, revision)
		}
	}

	var details struct {
		Properties map[string]struct {
			Ref string `json:"$ref"`
		} `json:"properties"`
		AdditionalProperties *bool `json:"additionalProperties"`
	}
	if err := json.Unmarshal(schema.Definitions["AdminAuditEntry"].Properties["details"], &details); err != nil {
		t.Fatalf("decode AdminAuditEntry details: %v", err)
	}
	if details.AdditionalProperties == nil || *details.AdditionalProperties {
		t.Fatal("AdminAuditEntry details must reject unknown properties")
	}
	for _, field := range []string{"before", "after"} {
		if details.Properties[field].Ref != "#/$defs/AccessPolicy" {
			t.Fatalf("AdminAuditEntry details.%s must reference AccessPolicy", field)
		}
	}
}

func TestAdminOperationsSchemas(t *testing.T) {
	schema := readAdminSchema(t)
	for _, definition := range []string{
		"AdminAccessWarning",
		"AdminSessionMetadata",
		"AdminSessionListResponse",
		"AdminPromptTrendPoint",
		"AdminPendingRequest",
		"AdminOverviewResponse",
	} {
		definitionSchema := requireDefinition(t, schema, definition)
		if definitionSchema.AdditionalProperties == nil || *definitionSchema.AdditionalProperties {
			t.Fatalf("%s must reject unknown properties", definition)
		}
	}

	required := map[string][]string{
		"AdminAccessWarning":       {"deviceId", "deviceName", "code", "message"},
		"AdminSessionMetadata":     {"sessionId", "title", "deviceId", "deviceName", "workspaceId", "workspaceName", "status", "updatedAt"},
		"AdminSessionListResponse": {"sessions", "warnings"},
		"AdminPromptTrendPoint":    {"date", "count"},
		"AdminPendingRequest":      {"interactionId", "kind", "title", "toolName", "deviceId", "deviceName", "sessionId", "workspaceId", "createdAt", "expiresAt"},
		"AdminOverviewResponse": {
			"devices", "users", "auditEntries", "recentActivity",
			"activeSessions", "todayPrompts", "pendingInteractions", "promptTrend", "sessions", "pendingRequests", "warnings",
		},
	}
	for definition, fields := range required {
		definitionSchema := requireDefinition(t, schema, definition)
		for _, field := range fields {
			if !contains(definitionSchema.Required, field) {
				t.Fatalf("%s must require %s", definition, field)
			}
			if _, exists := definitionSchema.Properties[field]; !exists {
				t.Fatalf("%s is missing property %s", definition, field)
			}
		}
	}

	arrayReferences := []struct {
		definition string
		property   string
		wantRef    string
	}{
		{"AdminSessionListResponse", "sessions", "#/$defs/AdminSessionMetadata"},
		{"AdminSessionListResponse", "warnings", "#/$defs/AdminAccessWarning"},
		{"AdminOverviewResponse", "promptTrend", "#/$defs/AdminPromptTrendPoint"},
		{"AdminOverviewResponse", "sessions", "#/$defs/AdminSessionMetadata"},
		{"AdminOverviewResponse", "pendingRequests", "#/$defs/AdminPendingRequest"},
		{"AdminOverviewResponse", "warnings", "#/$defs/AdminAccessWarning"},
	}
	for _, check := range arrayReferences {
		var arraySchema struct {
			MaxItems int `json:"maxItems"`
			Items    struct {
				Ref string `json:"$ref"`
			} `json:"items"`
		}
		raw := schema.Definitions[check.definition].Properties[check.property]
		if err := json.Unmarshal(raw, &arraySchema); err != nil {
			t.Fatalf("decode %s.%s: %v", check.definition, check.property, err)
		}
		if arraySchema.Items.Ref != check.wantRef {
			t.Fatalf("%s.%s items reference=%q; want %q", check.definition, check.property, arraySchema.Items.Ref, check.wantRef)
		}
		if check.definition == "AdminOverviewResponse" && check.property == "sessions" && arraySchema.MaxItems != 5 {
			t.Fatalf("AdminOverviewResponse.sessions maxItems=%d; want 5", arraySchema.MaxItems)
		}
	}
}

func TestAdminM4OpenAPIContract(t *testing.T) {
	raw, err := os.ReadFile("../../../protocol/openapi.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI: %v", err)
	}
	var spec openAPISpec
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse OpenAPI: %v", err)
	}

	roleChecks := []struct {
		path      string
		method    string
		allowed   []string
		forbidden []string
	}{
		{path: "/v1/admin/interactions", method: "get", allowed: []string{"owner", "admin", "auditor"}, forbidden: []string{"member"}},
		{path: "/v1/admin/approval-policy", method: "get", allowed: []string{"owner", "admin", "auditor"}, forbidden: []string{"member"}},
		{path: "/v1/admin/approval-policy", method: "patch", allowed: []string{"owner", "admin"}, forbidden: []string{"auditor", "member"}},
		{path: "/v1/admin/settings", method: "get", allowed: []string{"owner", "admin"}, forbidden: []string{"auditor", "member"}},
	}
	for _, check := range roleChecks {
		operation := requireOperation(t, spec, check.path, check.method)
		description := strings.ToLower(operation.Description)
		for _, role := range check.allowed {
			if !strings.Contains(description, role) {
				t.Errorf("%s %s description must allow %s, got %q", check.method, check.path, role, operation.Description)
			}
		}
		for _, role := range check.forbidden {
			if strings.Contains(description, role) {
				t.Errorf("%s %s description must not allow %s, got %q", check.method, check.path, role, operation.Description)
			}
		}
	}

	responseReferences := []struct {
		path    string
		method  string
		wantRef string
	}{
		{path: "/v1/admin/interactions", method: "get", wantRef: "schemas/v1/admin.schema.json#/$defs/AdminInteractionListResponse"},
		{path: "/v1/admin/approval-policy", method: "get", wantRef: "schemas/v1/admin.schema.json#/$defs/ApprovalPolicy"},
		{path: "/v1/admin/approval-policy", method: "patch", wantRef: "schemas/v1/admin.schema.json#/$defs/ApprovalPolicy"},
		{path: "/v1/admin/settings", method: "get", wantRef: "schemas/v1/admin.schema.json#/$defs/AdminRuntimeSettings"},
	}
	for _, check := range responseReferences {
		operation := requireOperation(t, spec, check.path, check.method)
		response, exists := operation.Responses["200"]
		if !exists {
			t.Fatalf("%s %s is missing its 200 response", check.method, check.path)
		}
		if got := response.Content["application/json"].Schema.Ref; got != check.wantRef {
			t.Errorf("%s %s 200 schema reference=%q; want %q", check.method, check.path, got, check.wantRef)
		}
	}

	patch := requireOperation(t, spec, "/v1/admin/approval-policy", "patch")
	if patch.RequestBody == nil || !patch.RequestBody.Required {
		t.Fatal("PATCH /v1/admin/approval-policy must require a JSON body")
	}
	if got := patch.RequestBody.Content["application/json"].Schema.Ref; got != "schemas/v1/admin.schema.json#/$defs/ApprovalPolicyUpdateRequest" {
		t.Fatalf("approval-policy PATCH request reference=%q", got)
	}
	conflict, exists := patch.Responses["409"]
	if !exists {
		t.Fatal("PATCH /v1/admin/approval-policy must define a 409 revision conflict")
	}
	conflictDescription := strings.ToLower(conflict.Description)
	if !strings.Contains(conflictDescription, "revision") || !strings.Contains(conflictDescription, "stale") {
		t.Fatalf("approval-policy 409 must describe a stale revision, got %q", conflict.Description)
	}

	for path, operations := range spec.Paths {
		if strings.HasPrefix(path, "/v1/admin/interactions/") {
			t.Errorf("unexpected Admin interaction subpath %s; Admin interactions are read-only", path)
		}
		if strings.HasPrefix(path, "/v1/admin/") && strings.Contains(strings.ToLower(path), "decision") {
			t.Errorf("unexpected Admin decision path %s", path)
		}
		if path == "/v1/admin/interactions" && len(operations) != 1 {
			t.Errorf("Admin interactions must expose only GET, got %v", operations)
		}
	}
	if _, exists := spec.Paths["/v1/mobile/interactions/{interactionId}/decision"]["post"]; !exists {
		t.Fatal("the existing mobile interaction decision operation must remain available")
	}
}

func TestAdminM4Schemas(t *testing.T) {
	schema := readAdminSchema(t)
	propertyFields := map[string][]string{
		"AdminInteractionDetail": {
			"interactionId", "kind", "title", "toolName", "reason", "callId", "questions",
			"deviceId", "deviceName", "sessionId", "workspaceId", "workspaceName", "createdAt", "expiresAt",
		},
		"AdminInteractionListResponse": {"interactions"},
		"ApprovalPolicy":               {"remoteEnabled", "ttlSeconds", "revision", "createdAt", "updatedAt"},
		"ApprovalPolicyUpdateRequest":  {"remoteEnabled", "ttlSeconds", "revision"},
		"AdminRuntimeSettings": {
			"serverUrl", "pairingCodeTTLSeconds", "mobileAccessTokenTTLSeconds", "adminSessionTTLSeconds",
			"commandTimeoutSeconds", "attachmentsMode", "maxAttachmentBytes", "attachmentTTLSeconds",
			"goVersion", "databaseDialect", "databaseConnected", "generatedAt",
		},
	}
	for definition, fields := range propertyFields {
		definitionSchema := requireDefinition(t, schema, definition)
		if definitionSchema.AdditionalProperties == nil || *definitionSchema.AdditionalProperties {
			t.Errorf("%s must reject unknown properties", definition)
		}
		if len(definitionSchema.Properties) != len(fields) {
			t.Errorf("%s properties=%v; want exactly %v", definition, definitionSchema.Properties, fields)
		}
		for _, field := range fields {
			if _, exists := definitionSchema.Properties[field]; !exists {
				t.Errorf("%s is missing property %s", definition, field)
			}
		}
	}

	requiredFields := map[string][]string{
		"AdminInteractionDetail": {
			"interactionId", "kind", "title", "deviceId", "deviceName", "sessionId",
			"workspaceId", "workspaceName", "createdAt", "expiresAt",
		},
		"AdminInteractionListResponse": {"interactions"},
		"ApprovalPolicy":               {"remoteEnabled", "ttlSeconds", "revision", "createdAt", "updatedAt"},
		"ApprovalPolicyUpdateRequest":  {"revision"},
		"AdminRuntimeSettings":         propertyFields["AdminRuntimeSettings"],
	}
	for definition, fields := range requiredFields {
		definitionSchema := requireDefinition(t, schema, definition)
		if len(definitionSchema.Required) != len(fields) {
			t.Errorf("%s required=%v; want exactly %v", definition, definitionSchema.Required, fields)
		}
		for _, field := range fields {
			if !contains(definitionSchema.Required, field) {
				t.Errorf("%s must require %s", definition, field)
			}
		}
	}

	detail := requireDefinition(t, schema, "AdminInteractionDetail")
	if _, exists := detail.Properties["callID"]; exists {
		t.Fatal("AdminInteractionDetail must use callId, not callID")
	}
	for _, forbidden := range []string{
		"answers", "decision", "token", "tokenHash", "password", "passwordHash",
		"apns", "apnsCredentials", "fcm", "fcmCredentials", "messages", "content",
		"body", "transcript", "cwd", "path", "workspacePath",
	} {
		if _, exists := detail.Properties[forbidden]; exists {
			t.Errorf("AdminInteractionDetail unexpectedly exposes %s", forbidden)
		}
	}

	arrayReferences := []struct {
		definition  string
		property    string
		wantRef     string
		wantMaxItem int
	}{
		{definition: "AdminInteractionDetail", property: "questions", wantRef: "interaction.schema.json#/$defs/InteractionQuestion", wantMaxItem: 8},
		{definition: "AdminInteractionListResponse", property: "interactions", wantRef: "#/$defs/AdminInteractionDetail"},
	}
	for _, check := range arrayReferences {
		var arraySchema struct {
			MaxItems int `json:"maxItems"`
			Items    struct {
				Ref string `json:"$ref"`
			} `json:"items"`
		}
		raw := schema.Definitions[check.definition].Properties[check.property]
		if err := json.Unmarshal(raw, &arraySchema); err != nil {
			t.Fatalf("decode %s.%s: %v", check.definition, check.property, err)
		}
		if arraySchema.Items.Ref != check.wantRef {
			t.Errorf("%s.%s items reference=%q; want %q", check.definition, check.property, arraySchema.Items.Ref, check.wantRef)
		}
		if check.wantMaxItem != 0 && arraySchema.MaxItems != check.wantMaxItem {
			t.Errorf("%s.%s maxItems=%d; want %d", check.definition, check.property, arraySchema.MaxItems, check.wantMaxItem)
		}
	}

	for _, definition := range []string{"ApprovalPolicy", "ApprovalPolicyUpdateRequest"} {
		var ttl struct {
			Type    string `json:"type"`
			Minimum int    `json:"minimum"`
			Maximum int    `json:"maximum"`
		}
		if err := json.Unmarshal(schema.Definitions[definition].Properties["ttlSeconds"], &ttl); err != nil {
			t.Fatalf("decode %s ttlSeconds: %v", definition, err)
		}
		if ttl.Type != "integer" || ttl.Minimum != 30 || ttl.Maximum != 600 {
			t.Errorf("%s ttlSeconds must be an integer from 30 through 600, got %+v", definition, ttl)
		}
		var revision struct {
			Type    string `json:"type"`
			Format  string `json:"format"`
			Minimum int    `json:"minimum"`
		}
		if err := json.Unmarshal(schema.Definitions[definition].Properties["revision"], &revision); err != nil {
			t.Fatalf("decode %s revision: %v", definition, err)
		}
		if revision.Type != "integer" || revision.Format != "int64" || revision.Minimum != 1 {
			t.Errorf("%s revision must be a positive integer/int64, got %+v", definition, revision)
		}
	}

	settings := requireDefinition(t, schema, "AdminRuntimeSettings")
	for _, forbidden := range []string{
		"token", "accessToken", "refreshToken", "bootstrapToken", "mobileAccessToken", "mobileRefreshToken",
		"adminSessionToken", "tokenHash", "password", "passwordHash", "bootstrapOwnerPassword",
		"apns", "apnsKey", "apnsCredential", "apnsCredentials", "fcm", "fcmKey", "fcmServerKey",
		"fcmCredential", "fcmCredentials", "fcmServiceAccount", "credential", "credentials", "secret",
		"databaseUrl", "attachmentDir",
	} {
		if _, exists := settings.Properties[forbidden]; exists {
			t.Errorf("AdminRuntimeSettings unexpectedly exposes %s", forbidden)
		}
	}
}

func requireOperation(t *testing.T, spec openAPISpec, path, method string) operationSpec {
	t.Helper()
	node, exists := spec.Paths[path][method]
	if !exists {
		t.Fatalf("missing operation %s %s", method, path)
	}
	var operation operationSpec
	if err := node.Decode(&operation); err != nil {
		t.Fatalf("decode operation %s %s: %v", method, path, err)
	}
	return operation
}

func readAdminSchema(t *testing.T) jsonSchema {
	t.Helper()
	raw, err := os.ReadFile("../../../protocol/schemas/v1/admin.schema.json")
	if err != nil {
		t.Fatalf("read Admin schema: %v", err)
	}
	var schema jsonSchema
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatalf("parse Admin schema: %v", err)
	}
	return schema
}

func requireDefinition(t *testing.T, schema jsonSchema, name string) jsonSchemaDefinition {
	t.Helper()
	definition, exists := schema.Definitions[name]
	if !exists {
		t.Fatalf("missing Admin schema definition %s", name)
	}
	return definition
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
