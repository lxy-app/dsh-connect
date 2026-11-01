package server

import (
	"testing"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
)

func TestRequiredScope(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		protocol.MethodSessionList:     "read",
		protocol.MethodSessionPage:     "read",
		protocol.MethodSessionFollow:   "read",
		protocol.MethodSessionUnfollow: "read",
		protocol.MethodSessionCreate:   "prompt",
		protocol.MethodSessionPrompt:   "prompt",
		protocol.MethodSessionCancel:   "cancel",
	}
	for method, expected := range tests {
		actual, ok := requiredScope(method)
		if !ok || actual != expected {
			t.Errorf("requiredScope(%q) = %q, %v; want %q, true", method, actual, ok, expected)
		}
	}
	if _, ok := requiredScope("shell.exec"); ok {
		t.Fatal("arbitrary methods must not receive a scope")
	}
}
