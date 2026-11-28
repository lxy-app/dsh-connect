package server

import "github.com/go-chi/chi/v5"

// mobileRoutes registers every phone-facing endpoint. Login and refresh are
// public credential exchanges; the remaining REST routes require Mobile auth.
func (s *Server) mobileRoutes(mux chi.Router) {
	mux.Route("/v1/mobile", func(r chi.Router) {
		routePOST(r, "/auth/login", s.handleMobileLogin)
		routePOST(r, "/auth/refresh", s.handleMobileRefresh)

		// Only the browser WebSocket handshake accepts an accessToken query
		// parameter. Ordinary Mobile REST endpoints keep header-only auth.
		routeGET(r.With(s.mobileAuthWS), "/events/ws", s.handleMobileEvents)

		r.Group(func(r chi.Router) {
			r.Use(s.mobileAuth)
			routePOST(r, "/auth/logout", s.handleMobileLogout)
			routeGET(r, "/me", s.handleMobileMe)
			routeGET(r, "/access", s.handleMobileAccessOverview)
			routeGET(r, "/workspaces", s.handleMobileWorkspaces)
			routeGET(r, "/workspaces/{workspaceId}/model", s.handleMobileWorkspaceModel)
			routeGET(r, "/sessions", s.handleMobileSessionList)
			routePOST(r, "/sessions", s.handleMobileSessionCreate)
			routeGET(r, "/sessions/{sessionId}/messages", s.handleMobileSessionMessages)
			routeGET(r, "/sessions/{sessionId}/model", s.handleMobileSessionModel)
			routePOST(r, "/sessions/{sessionId}/model", s.handleMobileSessionModelSelect)
			routePOST(r, "/sessions/{sessionId}/prompt", s.handleMobileSessionPrompt)
			routePOST(r, "/sessions/{sessionId}/cancel", s.handleMobileSessionCancel)
			routePOST(r, "/sessions/{sessionId}/attachments", s.handleMobileAttachmentUpload)
			routeGET(r, "/interactions", s.handleMobileInteractions)
			routePOST(r, "/interactions/{interactionId}/decision", s.handleMobileInteractionDecision)
			routeGET(r, "/attachments/{attachmentId}", s.handleMobileAttachment)
			routeGET(r, "/attachments/{attachmentId}/preview", s.handleMobileAttachmentPreview)
		})
	})
}
