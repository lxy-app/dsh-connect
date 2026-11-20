package protocol

import (
	"encoding/json"
	"os"
	"testing"
)

func TestConnectorRequestSchemaKeepsSupportedMethods(t *testing.T) {
	method := readSchemaNode(t, "commands.schema.json", "$defs", "ConnectorRequest", "properties", "method")
	requireSchemaEnum(t, method, "pair.updateGrants", "interaction.audience")
}

func TestMobileSchemaSupportsEffectiveWorkspaceScopes(t *testing.T) {
	sessionScopes := readSchemaNode(t, "mobile.schema.json", "$defs", "MobileSessionView", "properties", "scopes", "items")
	requireSchemaEnum(t, sessionScopes, "read", "prompt", "approve", "cancel")
	workspaceScopes := readSchemaNode(t, "mobile.schema.json", "$defs", "MobileWorkspaceSummary", "properties", "scopes", "items")
	requireSchemaEnum(t, workspaceScopes, "read", "prompt", "approve", "cancel")
}

func readSchemaNode(t *testing.T, name string, path ...string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile("../../../protocol/schemas/v1/" + name)
	if err != nil {
		t.Fatalf("read schema %s: %v", name, err)
	}
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		t.Fatalf("decode schema %s: %v", name, err)
	}
	current := root
	for _, segment := range path {
		next, ok := current[segment].(map[string]any)
		if !ok {
			t.Fatalf("schema %s missing object path segment %q", name, segment)
		}
		current = next
	}
	return current
}

func requireSchemaEnum(t *testing.T, node map[string]any, values ...string) {
	t.Helper()
	raw, ok := node["enum"].([]any)
	if !ok {
		t.Fatalf("schema node has no enum: %+v", node)
	}
	actual := make(map[string]bool, len(raw))
	for _, value := range raw {
		text, ok := value.(string)
		if ok {
			actual[text] = true
		}
	}
	for _, value := range values {
		if !actual[value] {
			t.Fatalf("schema enum lacks %q: %+v", value, raw)
		}
	}
}
