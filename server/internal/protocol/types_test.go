package protocol

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestEphemeralEventOmitsDurableSequence(t *testing.T) {
	t.Parallel()
	event := Event{V: 1, Type: TypeEvent, EventID: "evt_1", DeviceID: "dev_1", SessionID: "s1", Kind: "assistant.stream", Data: json.RawMessage(`{"delta":"ok"}`)}
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte(`"seq"`)) {
		t.Fatalf("ephemeral stream must not acquire a durable seq: %s", encoded)
	}

	event.Kind = "session.event"
	event.Seq = 1
	encoded, err = json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte(`"seq":1`)) {
		t.Fatalf("durable event lost its sequence: %s", encoded)
	}
}
