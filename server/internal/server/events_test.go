package server

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
)

func TestMobileStreamEventFiltersRawToolPayloads(t *testing.T) {
	at := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	event := func(kind, dataType string) protocol.Event {
		data, err := json.Marshal(map[string]any{"type": dataType, "payload": map[string]any{"text": "x"}})
		if err != nil {
			t.Fatal(err)
		}
		return protocol.Event{V: 1, Type: protocol.TypeEvent, EventID: "evt_1", DeviceID: "dev_1", SessionID: "s1", Kind: kind, OccurredAt: at, Data: data}
	}
	for _, kind := range []string{"assistant.stream", "session.snapshot", "connector.error", "session.resync_required", protocol.EventKindAttachmentReady} {
		if !mobileStreamEvent(protocol.Event{Kind: kind}) {
			t.Fatalf("kind %q should be allowed on the mobile socket", kind)
		}
	}
	for _, dataType := range []string{"user/message", "assistant/message", "turn/start", "turn/end"} {
		if !mobileStreamEvent(event("session.event", dataType)) {
			t.Fatalf("session event %q should be allowed", dataType)
		}
	}
	for _, dataType := range []string{"tool/call", "tool/result", "step/start", "request/header"} {
		if mobileStreamEvent(event("session.event", dataType)) {
			t.Fatalf("session event %q should be filtered from the mobile socket", dataType)
		}
	}
	if mobileStreamEvent(event("other.kind", "assistant/message")) {
		t.Fatal("unknown event kinds should be filtered")
	}
}
