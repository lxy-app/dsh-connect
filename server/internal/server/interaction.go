package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
)

// interactionMaxTTL bounds how long a phone may keep an approval or question
// answerable, regardless of what a Connector asks for.
const interactionMaxTTL = 10 * time.Minute

// interactionPresenceWindow tolerates one missed 2-second phone poll before the
// Connector stops treating that phone as actively watching.
const interactionPresenceWindow = 10 * time.Second

type interactionEntry struct {
	data      protocol.InteractionRequestData
	decided   bool
	decidedAt time.Time
}

// InteractionStore keeps the short-lived pending approvals/questions that a
// Connector has forwarded. Approvals are one-shot decisions, so this state is
// intentionally in-memory: a Server restart fails closed instead of
// resurrecting a stale prompt.
type InteractionStore struct {
	mu       sync.Mutex
	ttl      time.Duration
	items    map[string]*interactionEntry
	lastPoll map[string]time.Time
}

func NewInteractionStore(ttl time.Duration) *InteractionStore {
	if ttl <= 0 || ttl > interactionMaxTTL {
		ttl = interactionMaxTTL
	}
	return &InteractionStore{ttl: ttl, items: make(map[string]*interactionEntry), lastPoll: make(map[string]time.Time)}
}

func (s *InteractionStore) Put(deviceID string, data protocol.InteractionRequestData, now time.Time) {
	if data.InteractionID == "" || data.SessionID == "" || data.WorkspaceID == "" {
		return
	}
	data.DeviceID = deviceID
	if data.CreatedAt.IsZero() {
		data.CreatedAt = now
	}
	if data.ExpiresAt.IsZero() || data.ExpiresAt.After(now.Add(s.ttl)) {
		data.ExpiresAt = now.Add(s.ttl)
	}
	if !data.ExpiresAt.After(now) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.items) > 64 {
		for id, entry := range s.items {
			if !entry.data.ExpiresAt.After(now) {
				delete(s.items, id)
			}
		}
	}
	if existing, ok := s.items[data.InteractionID]; ok {
		// A retransmitted request must not resurrect a decision that is already
		// being delivered to the Connector.
		if existing.decided {
			return
		}
		existing.data = data
		return
	}
	s.items[data.InteractionID] = &interactionEntry{data: data}
}

// SawPoll records that one phone just listed its pending interactions. The
// Connector uses this short-lived presence to decide whether the phone should
// own the next prompt or whether the desktop should answer immediately.
func (s *InteractionStore) SawPoll(mobileDeviceID string, at time.Time) {
	s.mu.Lock()
	s.lastPoll[mobileDeviceID] = at
	s.mu.Unlock()
}

// Watching reports whether any of the candidate phones polled recently.
func (s *InteractionStore) Watching(mobileDeviceIDs []string, at time.Time, within time.Duration) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, id := range mobileDeviceIDs {
		if last, ok := s.lastPoll[id]; ok && at.Sub(last) <= within && !last.After(at) {
			return true
		}
	}
	return false
}

func (s *InteractionStore) Remove(interactionID string) {
	s.mu.Lock()
	delete(s.items, interactionID)
	s.mu.Unlock()
}

func (s *InteractionStore) DropDevice(deviceID string) {
	s.mu.Lock()
	for id, entry := range s.items {
		if entry.data.DeviceID == deviceID {
			delete(s.items, id)
		}
	}
	s.mu.Unlock()
}

// reserve atomically claims one pending interaction for a phone decision.
func (s *InteractionStore) reserve(interactionID string, now time.Time) (protocol.InteractionRequestData, *protocol.Error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.items[interactionID]
	if !ok {
		return protocol.InteractionRequestData{}, errorPtr(protocol.NewError(protocol.CodeInteractionNotFound, "the interaction is no longer pending", true))
	}
	if entry.decided {
		return protocol.InteractionRequestData{}, errorPtr(protocol.NewError(protocol.CodeInteractionDecided, "another client already decided this interaction", false))
	}
	if !entry.data.ExpiresAt.After(now) {
		delete(s.items, interactionID)
		return protocol.InteractionRequestData{}, errorPtr(protocol.NewError(protocol.CodeInteractionExpired, "the interaction has expired", false))
	}
	entry.decided = true
	entry.decidedAt = now
	return entry.data, nil
}

func (s *InteractionStore) release(interactionID string) {
	s.mu.Lock()
	if entry, ok := s.items[interactionID]; ok {
		entry.decided = false
		entry.decidedAt = time.Time{}
	}
	s.mu.Unlock()
}

func (s *InteractionStore) list(now time.Time) []protocol.InteractionRequestData {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]protocol.InteractionRequestData, 0, len(s.items))
	for id, entry := range s.items {
		if !entry.data.ExpiresAt.After(now) {
			delete(s.items, id)
			continue
		}
		if entry.decided {
			continue
		}
		result = append(result, entry.data)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.Before(result[j].CreatedAt) })
	return result
}

// ---------- Connector event ingestion ----------

// ingestInteractionEvent stores or clears one remote interaction. Unknown or
// malformed interaction events are dropped: a phone must never render a prompt
// the Server cannot correlate with a live Connector request.
func (s *Server) ingestInteractionEvent(event protocol.Event) {
	now := nowUTC()
	switch event.Kind {
	case protocol.KindInteractionRequest:
		var data protocol.InteractionRequestData
		if err := json.Unmarshal(event.Data, &data); err != nil {
			return
		}
		if !validID(data.InteractionID) || !validID(data.WorkspaceID) || !validText(data.Title, 512) {
			return
		}
		if data.Kind != protocol.InteractionKindApproval && data.Kind != protocol.InteractionKindQuestion {
			return
		}
		if data.Kind == protocol.InteractionKindQuestion && len(data.Questions) == 0 {
			return
		}
		// The session identity is part of the event envelope; a payload that
		// disagrees with it is rejected rather than trusted.
		if data.SessionID != "" && data.SessionID != event.SessionID {
			return
		}
		data.SessionID = event.SessionID
		data.DeviceID = event.DeviceID
		s.interactions.Put(event.DeviceID, data, now)
	case protocol.KindInteractionResolved:
		var data protocol.InteractionResolvedData
		if err := json.Unmarshal(event.Data, &data); err != nil {
			return
		}
		if validID(data.InteractionID) {
			s.interactions.Remove(data.InteractionID)
		}
	}
}

// ---------- Mobile routes ----------

func (s *Server) mobileInteractionRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/mobile/interactions", s.mobileAuth(s.handleMobileInteractions))
	mux.HandleFunc("POST /v1/mobile/interactions/{interactionId}/decision", s.mobileAuth(s.handleMobileInteractionDecision))
}

func (s *Server) handleMobileInteractions(w http.ResponseWriter, r *http.Request) {
	actor, ok := mobileFromContext(r.Context())
	if !ok {
		writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "mobile authentication required", false))
		return
	}
	s.interactions.SawPoll(actor.Device.Device.MobileDeviceID, nowUTC())
	deviceFilter := r.URL.Query().Get("deviceId")
	sessionFilter := r.URL.Query().Get("sessionId")
	if deviceFilter != "" && !validID(deviceFilter) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid deviceId required", false))
		return
	}
	if sessionFilter != "" && !validID(sessionFilter) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid sessionId required", false))
		return
	}
	grants, err := s.store.MobileAccessGrantsForMobile(r.Context(), actor.Device.Device.MobileDeviceID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load mobile access grants", true))
		return
	}
	access, err := s.policyAccessForUser(r.Context(), actor.User.ID)
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not resolve user access policy", true))
		return
	}
	type grantKey struct{ deviceID, workspaceID string }
	allowed := make(map[grantKey]struct{}, len(grants))
	for _, grant := range grants {
		if grant.Status != "active" || !hasScope(grant.Scopes, "approve") {
			continue
		}
		for _, workspace := range grant.Workspaces {
			if access.allows(grant.DeviceID, workspace.ID, "approve") {
				allowed[grantKey{deviceID: grant.DeviceID, workspaceID: workspace.ID}] = struct{}{}
			}
		}
	}
	deviceNames := map[string]string{}
	if devices, deviceErr := s.store.Devices(r.Context()); deviceErr == nil {
		for _, device := range devices {
			deviceNames[device.Device.DeviceID] = device.Device.DeviceName
		}
	}
	items := s.interactions.list(nowUTC())
	result := make([]protocol.MobileInteraction, 0, len(items))
	for _, item := range items {
		if deviceFilter != "" && item.DeviceID != deviceFilter {
			continue
		}
		if sessionFilter != "" && item.SessionID != sessionFilter {
			continue
		}
		if _, ok := allowed[grantKey{deviceID: item.DeviceID, workspaceID: item.WorkspaceID}]; !ok {
			continue
		}
		result = append(result, protocol.MobileInteraction{
			InteractionID: item.InteractionID,
			Kind:          item.Kind,
			DeviceID:      item.DeviceID,
			DeviceName:    deviceNames[item.DeviceID],
			WorkspaceID:   item.WorkspaceID,
			WorkspaceName: item.WorkspaceName,
			SessionID:     item.SessionID,
			Title:         item.Title,
			ToolName:      item.ToolName,
			Reason:        item.Reason,
			CallID:        item.CallID,
			Questions:     item.Questions,
			CreatedAt:     item.CreatedAt,
			ExpiresAt:     item.ExpiresAt,
		})
	}
	writeJSON(w, http.StatusOK, protocol.MobileInteractionListResponse{Interactions: result})
}

// connectorInteractionAudience answers whether a phone is actively watching
// this desktop/workspace. The Connector only offers a prompt to the phone when
// someone is there to answer; otherwise the desktop keeps its native prompt and
// the phone never gets a second, unreachable copy.
func (s *Server) connectorInteractionAudience(ctx context.Context, deviceID string, params json.RawMessage) (protocol.InteractionAudienceResponse, *protocol.Error) {
	var input struct {
		WorkspaceID string `json:"workspaceId"`
	}
	if commandError := decodeRawJSON(params, &input); commandError != nil {
		return protocol.InteractionAudienceResponse{}, commandError
	}
	if !validID(input.WorkspaceID) {
		return protocol.InteractionAudienceResponse{}, errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "workspaceId is required", false))
	}
	grants, err := s.store.MobileAccessGrantsForDevice(ctx, deviceID)
	if err != nil {
		return protocol.InteractionAudienceResponse{}, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not load mobile access grants", true))
	}
	candidates := make([]string, 0, len(grants))
	accessByUser := make(map[string]policyAccess)
	for _, grant := range grants {
		if grant.Status != "active" || !hasScope(grant.Scopes, "approve") {
			continue
		}
		access, loaded := accessByUser[grant.UserID]
		if !loaded {
			var accessErr error
			access, accessErr = s.policyAccessForUser(ctx, grant.UserID)
			if accessErr != nil {
				return protocol.InteractionAudienceResponse{}, errorPtr(protocol.NewError(protocol.CodeInternalError, "could not resolve user access policy", true))
			}
			accessByUser[grant.UserID] = access
		}
		allowed := false
		for _, workspace := range grant.Workspaces {
			if workspace.ID == input.WorkspaceID && access.allows(deviceID, input.WorkspaceID, "approve") {
				allowed = true
				break
			}
		}
		if allowed {
			candidates = append(candidates, grant.MobileDeviceID)
		}
	}
	return protocol.InteractionAudienceResponse{
		Watching: s.interactions.Watching(candidates, nowUTC(), interactionPresenceWindow),
	}, nil
}

func (s *Server) handleMobileInteractionDecision(w http.ResponseWriter, r *http.Request) {
	interactionID := r.PathValue("interactionId")
	if !validID(interactionID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "valid interactionId required", false))
		return
	}
	var request protocol.MobileInteractionDecisionRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if !validID(request.RequestID) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "requestId is required", false))
		return
	}
	now := nowUTC()
	item, commandError := s.interactions.reserve(interactionID, now)
	if commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	fail := func(err *protocol.Error) {
		s.interactions.release(interactionID)
		if err.Code == protocol.CodeInteractionNotFound || err.Code == protocol.CodeInteractionExpired {
			s.interactions.Remove(interactionID)
		}
		writeAPIError(w, *err)
	}
	actor, commandError := s.authorizeMobileSession(r, item.DeviceID, item.WorkspaceID, item.SessionID, "approve")
	if commandError != nil {
		fail(commandError)
		return
	}
	if commandError := validateInteractionDecision(item, request); commandError != nil {
		fail(commandError)
		return
	}
	params := protocol.InteractionRespondParams{
		InteractionID: item.InteractionID,
		Kind:          item.Kind,
		WorkspaceID:   item.WorkspaceID,
		Decision:      request.Decision,
		Answers:       request.Answers,
	}
	result, commandError := s.router.Execute(
		r.Context(), protocol.MethodInteractionRespond, item.DeviceID, request.RequestID, params, s.config.CommandTimeout,
	)
	s.auditMobileSession(actor, r, "mobile.interaction.decide", item.DeviceID, item.SessionID, request.RequestID, commandError)
	if commandError != nil {
		fail(commandError)
		return
	}
	s.interactions.Remove(interactionID)
	writeRawJSON(w, http.StatusOK, result)
}

// validateInteractionDecision enforces the one-shot vocabulary before a
// decision ever reaches the desktop.
func validateInteractionDecision(item protocol.InteractionRequestData, request protocol.MobileInteractionDecisionRequest) *protocol.Error {
	switch item.Kind {
	case protocol.InteractionKindApproval:
		if request.Decision != "allow-once" && request.Decision != "reject" {
			return errorPtr(protocol.NewError(protocol.CodeInteractionInvalid, "decision must be allow-once or reject", false))
		}
		if len(request.Answers) != 0 {
			return errorPtr(protocol.NewError(protocol.CodeInteractionInvalid, "approval decisions cannot carry answers", false))
		}
	case protocol.InteractionKindQuestion:
		if len(request.Answers) == 0 || len(request.Answers) > len(item.Questions) {
			return errorPtr(protocol.NewError(protocol.CodeInteractionInvalid, "one answer is required for every question", false))
		}
		byID := make(map[string]protocol.InteractionQuestion, len(item.Questions))
		for _, question := range item.Questions {
			byID[question.ID] = question
		}
		seen := make(map[string]struct{}, len(request.Answers))
		for _, answer := range request.Answers {
			question, ok := byID[answer.ID]
			if !ok {
				return errorPtr(protocol.NewError(protocol.CodeInteractionInvalid, "answer does not match a pending question", false))
			}
			if _, duplicate := seen[answer.ID]; duplicate {
				return errorPtr(protocol.NewError(protocol.CodeInteractionInvalid, "each question may be answered once", false))
			}
			seen[answer.ID] = struct{}{}
			if len(answer.Selected) > 16 || len(answer.Custom) > 4096 {
				return errorPtr(protocol.NewError(protocol.CodeInteractionInvalid, "answer is too large", false))
			}
			labels := make(map[string]struct{}, len(question.Options))
			for _, option := range question.Options {
				labels[option.Label] = struct{}{}
			}
			for _, label := range answer.Selected {
				if _, ok := labels[label]; !ok {
					return errorPtr(protocol.NewError(protocol.CodeInteractionInvalid, "answer selected an unknown option", false))
				}
			}
			if !question.MultiSelect && len(answer.Selected) > 1 {
				return errorPtr(protocol.NewError(protocol.CodeInteractionInvalid, "question is single-select", false))
			}
		}
		if len(seen) != len(item.Questions) {
			return errorPtr(protocol.NewError(protocol.CodeInteractionInvalid, "one answer is required for every question", false))
		}
	default:
		return errorPtr(protocol.NewError(protocol.CodeInteractionInvalid, "unsupported interaction kind", false))
	}
	return nil
}

// expireDeviceInteractions runs when a Connector disconnects: no desktop is
// left to answer, so every pending prompt is dropped instead of lingering.
func (s *Server) expireDeviceInteractions(deviceID string) {
	if deviceID == "" {
		return
	}
	s.interactions.DropDevice(deviceID)
}
