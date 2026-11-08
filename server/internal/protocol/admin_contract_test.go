package protocol_test

import (
	"encoding/json"
	"os"
	"testing"

	"gopkg.in/yaml.v3"
)

type openAPISpec struct {
	Paths map[string]map[string]yaml.Node `yaml:"paths"`
}

type operationSpec struct {
	OperationID string          `yaml:"operationId"`
	Parameters  []parameterSpec `yaml:"parameters"`
}

type parameterSpec struct {
	Name     string `yaml:"name"`
	In       string `yaml:"in"`
	Required bool   `yaml:"required"`
	Schema   struct {
		Type string `yaml:"type"`
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
	} {
		properties := requireDefinition(t, schema, definition).Properties
		for _, forbidden := range []string{
			"password", "passwordHash", "code", "codeHash", "token", "tokenHash",
			"deviceToken", "deviceTokenHash", "pairingToken", "pairingTokenHash", "path", "workspacePath",
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
