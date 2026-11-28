package server

import "github.com/go-chi/chi/v5"

// bootstrapRoutes keeps the bootstrap-token-only debug/legacy surface separate
// from Web Admin sessions, Mobile access tokens and Connector device tokens.
func (s *Server) bootstrapRoutes(mux chi.Router) {
	// Use an inline group instead of mounting /v1 with Use: mounted middleware
	// also handles that subtree's unknown paths, changing their 404 into 401.
	mux.Group(func(r chi.Router) {
		r.Use(s.requireAdmin)
		routePOST(r, "/v1/pairing/desktop-codes", s.handleCreatePairingCode)
		routeGET(r, "/v1/devices", s.handleDevices)
		routeGET(r, "/v1/sessions", s.handleSessionList)
		routePOST(r, "/v1/sessions", s.handleSessionCreate)
		routeGET(r, "/v1/sessions/{sessionId}/page", s.handleSessionPage)
		routePOST(r, "/v1/sessions/{sessionId}/prompt", s.handleSessionPrompt)
		routePOST(r, "/v1/sessions/{sessionId}/cancel", s.handleSessionCancel)
		routeGET(r, "/v1/events/ws", s.handleEvents)
	})
}
