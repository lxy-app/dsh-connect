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

func TestEventHubClosesOnlyRevokedMobileIdentities(t *testing.T) {
	hub := NewEventHub(1)
	phone, ok := hub.SubscribeMobile("dev-1", "s1", "mob-1", "usr-1")
	if !ok {
		t.Fatal("mobile SubscribeMobile() failed")
	}
	otherDesktop, ok := hub.SubscribeMobile("dev-4", "s4", "mob-1", "usr-1")
	if !ok {
		t.Fatal("other desktop SubscribeMobile() failed")
	}
	otherPhone, ok := hub.SubscribeMobile("dev-2", "s2", "mob-2", "usr-2")
	if !ok {
		t.Fatal("other mobile SubscribeMobile() failed")
	}
	admin, ok := hub.Subscribe("dev-3", "s3")
	if !ok {
		t.Fatal("admin Subscribe() failed")
	}

	hub.CloseMobileForDevice("mob-1", "dev-1")
	select {
	case <-phone.done:
		if phone.reason.Code != protocol.CodeUnauthorized {
			t.Fatalf("mobile close reason=%+v", phone.reason)
		}
	default:
		t.Fatal("revoked mobile subscription remained open")
	}
	select {
	case <-otherDesktop.done:
		t.Fatal("one desktop grant revocation closed another desktop stream")
	default:
	}
	hub.CloseMobile("mob-1")
	select {
	case <-otherDesktop.done:
		if otherDesktop.reason.Code != protocol.CodeUnauthorized {
			t.Fatalf("other desktop close reason=%+v", otherDesktop.reason)
		}
	default:
		t.Fatal("phone revocation did not close its other desktop stream")
	}
	for name, sub := range map[string]*subscription{"other phone": otherPhone, "admin": admin} {
		select {
		case <-sub.done:
			t.Fatalf("%s subscription was closed by another phone's revocation", name)
		default:
		}
	}

	// Cleanup for an old connection must not affect any other subscription.
	hub.Unsubscribe(phone)
	hub.CloseUser("usr-2")
	select {
	case <-otherPhone.done:
		if otherPhone.reason.Code != protocol.CodeUnauthorized {
			t.Fatalf("user close reason=%+v", otherPhone.reason)
		}
	default:
		t.Fatal("disabled user's subscription remained open")
	}
	select {
	case <-admin.done:
		t.Fatal("user revocation closed an admin subscription")
	default:
	}
}

func TestMobileReconnectCleanupDoesNotCloseReplacement(t *testing.T) {
	hub := NewEventHub(1)
	first, ok := hub.SubscribeMobile("dev-1", "s1", "mob-1", "usr-1")
	if !ok {
		t.Fatal("first mobile SubscribeMobile() failed")
	}
	second, ok := hub.SubscribeMobile("dev-1", "s1", "mob-1", "usr-1")
	if !ok {
		t.Fatal("replacement mobile SubscribeMobile() failed")
	}
	select {
	case <-first.done:
		if first.reason.Code != protocol.CodeFollowSuperseded {
			t.Fatalf("first close reason=%+v", first.reason)
		}
	default:
		t.Fatal("first subscription was not superseded")
	}

	hub.Unsubscribe(first)
	select {
	case <-second.done:
		t.Fatal("old connection cleanup closed the replacement")
	default:
	}
	hub.CloseMobile("mob-1")
	select {
	case <-second.done:
		if second.reason.Code != protocol.CodeUnauthorized {
			t.Fatalf("replacement close reason=%+v", second.reason)
		}
	default:
		t.Fatal("revocation did not close the replacement")
	}
}

func TestNewRequiresBootstrapToken(t *testing.T) {
	// Config validation runs before any database connection is attempted, so an
	// empty token must fail without a reachable PostgreSQL.
	if _, err := New(context.Background(), Config{}); err == nil {
		t.Fatal("New() accepted an empty bootstrap token")
	}
}
