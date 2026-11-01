package server

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
)

func TestEventHubDisconnectsSlowConsumer(t *testing.T) {
	hub := NewEventHub(1)
	sub, ok := hub.Subscribe("dev-1", "s1")
	if !ok {
		t.Fatal("Subscribe() failed")
	}
	event := protocol.Event{V: 1, Type: protocol.TypeEvent, EventID: "evt-1", DeviceID: "dev-1", SessionID: "s1", Seq: 1, Kind: "session.event", OccurredAt: time.Now().UTC(), Data: json.RawMessage(`{}`)}
	hub.Broadcast(event)
	event.EventID = "evt-2"
	event.Seq = 2
	hub.Broadcast(event)
	select {
	case <-sub.done:
		if sub.reason.Code != protocol.CodeSlowConsumer {
			t.Fatalf("close reason=%+v", sub.reason)
		}
	default:
		t.Fatal("slow subscription remained open")
	}
	if len(sub.ch) != 1 {
		t.Fatalf("buffer length=%d; bounded buffer should retain one pending event", len(sub.ch))
	}
}

func TestEventHubSupersedesSameDeviceSession(t *testing.T) {
	hub := NewEventHub(1)
	first, ok := hub.Subscribe("dev-1", "s1")
	if !ok {
		t.Fatal("first Subscribe() failed")
	}
	other, ok := hub.Subscribe("dev-1", "s2")
	if !ok {
		t.Fatal("other session Subscribe() failed")
	}
	second, ok := hub.Subscribe("dev-1", "s1")
	if !ok {
		t.Fatal("replacement Subscribe() failed")
	}
	select {
	case <-first.done:
		if first.reason.Code != protocol.CodeFollowSuperseded {
			t.Fatalf("first close reason=%+v", first.reason)
		}
	default:
		t.Fatal("replaced subscription remained open")
	}
	select {
	case <-other.done:
		t.Fatal("replacement closed another session")
	default:
	}
	select {
	case <-second.done:
		t.Fatal("new subscription was closed")
	default:
	}
}

func TestNewRequiresBootstrapToken(t *testing.T) {
	// Config validation runs before any database connection is attempted, so an
	// empty token must fail without a reachable PostgreSQL.
	if _, err := New(context.Background(), Config{}); err == nil {
		t.Fatal("New() accepted an empty bootstrap token")
	}
}
