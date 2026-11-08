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
	OperationID string `yaml:"operationId"`
}

type jsonSchema struct {
	Definitions map[string]struct {
		Required   []string                   `json:"required"`
		Properties map[string]json.RawMessage `json:"properties"`
	} `json:"$defs"`
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
		"/v1/admin/auth/login":                {"post"},
		"/v1/admin/auth/logout":               {"post"},
		"/v1/admin/auth/me":                   {"get"},
		"/v1/admin/overview":                  {"get"},
		"/v1/admin/users":                     {"get", "post"},
		"/v1/admin/users/{userId}":            {"patch", "delete"},
		"/v1/admin/devices":                   {"get"},
		"/v1/admin/devices/{deviceId}":        {"patch", "delete"},
		"/v1/admin/devices/{deviceId}/revoke": {"post"},
		"/v1/admin/audit":                     {"get"},
		"/v1/admin/pairing-codes":             {"get", "post"},
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
}

func TestAdminSchemasDoNotExposeCredentials(t *testing.T) {
	raw, err := os.ReadFile("../../../protocol/schemas/v1/admin.schema.json")
	if err != nil {
		t.Fatalf("read Admin schema: %v", err)
	}
	var schema jsonSchema
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatalf("parse Admin schema: %v", err)
	}
	for _, definition := range []string{"AdminUser", "AdminDesktopPairingCodeState"} {
		properties := schema.Definitions[definition].Properties
		for _, forbidden := range []string{"password", "passwordHash", "code", "codeHash", "tokenHash"} {
			if _, exists := properties[forbidden]; exists {
				t.Fatalf("%s unexpectedly exposes %s", definition, forbidden)
			}
		}
	}
	for _, definition := range []string{"AdminDesktopPairingCodeResponse", "AdminDesktopPairingCodeState"} {
		if !contains(schema.Definitions[definition].Required, "pairingId") {
			t.Fatalf("%s must require pairingId", definition)
		}
	}
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
