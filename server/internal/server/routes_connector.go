package server

import "github.com/go-chi/chi/v5"

// connectorRoutes registers the desktop Connector channel and its internal
// attachment byte transfers. Do not put one device-token middleware around the
// whole group: an unpaired desktop must be able to open the pairing WebSocket.
// The two attachment handlers authenticate the device and verify byte ownership.
func (s *Server) connectorRoutes(mux chi.Router) {
	mux.Route("/v1/connector", func(r chi.Router) {
		routeGET(r, "/ws", s.handleConnector)
		routePOST(r, "/attachments/{attachmentId}", s.handleConnectorAttachmentUpload)
		routeGET(r, "/uploads/{attachmentId}", s.handleConnectorUploadDownload)
	})
}
