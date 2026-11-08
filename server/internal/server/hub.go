package server

import (
	"sync"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
)

type Hub struct {
	mu      sync.RWMutex
	devices map[string]*connectorConn
	closing bool
}

func NewHub() *Hub {
	return &Hub{devices: make(map[string]*connectorConn)}
}

func (h *Hub) Register(conn *connectorConn) bool {
	h.mu.Lock()
	if h.closing {
		h.mu.Unlock()
		return false
	}
	previous := h.devices[conn.deviceID]
	h.devices[conn.deviceID] = conn
	h.mu.Unlock()
	if previous != nil && previous != conn {
		_ = previous.ws.Close(websocket.StatusGoingAway, "replacement connector connected")
	}
	return true
}

func (h *Hub) Get(deviceID string) *connectorConn {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.devices[deviceID]
}

func (h *Hub) Unregister(conn *connectorConn) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.devices[conn.deviceID] != conn {
		return false
	}
	delete(h.devices, conn.deviceID)
	return true
}

func (h *Hub) CloseAll() {
	h.mu.Lock()
	h.closing = true
	connections := make([]*connectorConn, 0, len(h.devices))
	for _, conn := range h.devices {
		connections = append(connections, conn)
	}
	h.devices = make(map[string]*connectorConn)
	h.mu.Unlock()
	for _, conn := range connections {
		_ = conn.ws.Close(websocket.StatusGoingAway, "server shutting down")
	}
}

type subscription struct {
	deviceID       string
	sessionID      string
	mobileDeviceID string
	userID         string
	ch             chan protocol.Event
	done           chan struct{}
	reason         protocol.Error
}

type EventHub struct {
	mu      sync.Mutex
	buffer  int
	closing bool
	subs    map[*subscription]struct{}
}

func NewEventHub(buffer int) *EventHub {
	return &EventHub{buffer: buffer, subs: make(map[*subscription]struct{})}
}

func (h *EventHub) Subscribe(deviceID, sessionID string) (*subscription, bool) {
	return h.subscribe(deviceID, sessionID, "", "")
}

// SubscribeMobile records the authenticated phone and user alongside the
// session coordinates so revocation can close already established streams.
func (h *EventHub) SubscribeMobile(deviceID, sessionID, mobileDeviceID, userID string) (*subscription, bool) {
	return h.subscribe(deviceID, sessionID, mobileDeviceID, userID)
}

func (h *EventHub) subscribe(deviceID, sessionID, mobileDeviceID, userID string) (*subscription, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closing {
		return nil, false
	}
	for previous := range h.subs {
		if previous.deviceID == deviceID && previous.sessionID == sessionID {
			previous.reason = protocol.NewError(protocol.CodeFollowSuperseded, "event follow was superseded by a newer App connection", false)
			delete(h.subs, previous)
			close(previous.done)
		}
	}
	sub := &subscription{
		deviceID:       deviceID,
		sessionID:      sessionID,
		mobileDeviceID: mobileDeviceID,
		userID:         userID,
		ch:             make(chan protocol.Event, h.buffer),
		done:           make(chan struct{}),
	}
	h.subs[sub] = struct{}{}
	return sub, true
}

func (h *EventHub) Unsubscribe(sub *subscription) {
	h.mu.Lock()
	delete(h.subs, sub)
	h.mu.Unlock()
}

// CloseMobile immediately revokes every live event stream owned by one phone.
func (h *EventHub) CloseMobile(mobileDeviceID string) {
	h.closeMatching(func(sub *subscription) bool {
		return sub.mobileDeviceID != "" && sub.mobileDeviceID == mobileDeviceID
	}, "mobile device access was revoked")
}

// CloseMobileForDevice closes only streams backed by one revoked desktop grant.
func (h *EventHub) CloseMobileForDevice(mobileDeviceID, deviceID string) {
	h.closeMatching(func(sub *subscription) bool {
		return sub.mobileDeviceID != "" && sub.mobileDeviceID == mobileDeviceID && sub.deviceID == deviceID
	}, "mobile grant was revoked")
}

// CloseDevice closes mobile streams for a desktop whose grants were narrowed.
func (h *EventHub) CloseDevice(deviceID string) {
	h.closeMatching(func(sub *subscription) bool {
		return sub.userID != "" && sub.deviceID == deviceID
	}, "desktop grants were updated")
}

// CloseUser immediately revokes every live mobile event stream owned by a user.
func (h *EventHub) CloseUser(userID string) {
	h.closeMatching(func(sub *subscription) bool {
		return sub.userID != "" && sub.userID == userID
	}, "user access was revoked")
}

func (h *EventHub) closeMatching(matches func(*subscription) bool, message string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.subs {
		if !matches(sub) {
			continue
		}
		sub.reason = protocol.NewError(protocol.CodeUnauthorized, message, false)
		delete(h.subs, sub)
		close(sub.done)
	}
}

func (h *EventHub) Broadcast(event protocol.Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.subs {
		if sub.deviceID != event.DeviceID || (sub.sessionID != "" && sub.sessionID != event.SessionID) {
			continue
		}
		select {
		case sub.ch <- event:
		default:
			sub.reason = protocol.NewError(protocol.CodeSlowConsumer, "event buffer full; reconnect with a cursor", true)
			delete(h.subs, sub)
			close(sub.done)
		}
	}
}

func (h *EventHub) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closing = true
	for sub := range h.subs {
		sub.reason = protocol.NewError(protocol.CodeDeviceOffline, "server shutting down", true)
		delete(h.subs, sub)
		close(sub.done)
	}
}
