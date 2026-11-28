package server

import (
	"github.com/deepseek/dsh-connect/server/internal/store"
	"github.com/go-chi/chi/v5"
)

// adminRoutes registers the Web Admin control plane. Mobile device management
// belongs here because it uses Admin credentials and roles, not Mobile tokens.
func (s *Server) adminRoutes(mux chi.Router) {
	mux.Route("/v1/admin", func(r chi.Router) {
		routePOST(r, "/auth/login", s.handleAdminLogin)

		r.Group(func(r chi.Router) {
			r.Use(s.adminAuth)
			routePOST(r, "/auth/logout", s.handleAdminLogout)
			routeGET(r, "/auth/me", s.handleAdminMe)
		})

		r.Group(func(r chi.Router) {
			r.Use(s.requireRole(store.RoleOwner, store.RoleAdmin, store.RoleAuditor))
			routeGET(r, "/overview", s.handleAdminOverview)
			routeGET(r, "/sessions", s.handleAdminSessions)
			routeGET(r, "/interactions", s.handleAdminInteractions)
			routeGET(r, "/approval-policy", s.handleAdminApprovalPolicy)
			routeGET(r, "/users", s.handleAdminUsers)
			routeGET(r, "/users/{userId}/access-preview", s.handleAdminAccessPreview)
			routeGET(r, "/policies", s.handleAdminAccessPolicies)
			routeGET(r, "/devices", s.handleAdminDevices)
			routeGET(r, "/mobile-devices", s.handleAdminMobileDevices)
			routeGET(r, "/audit", s.handleAdminAudit)
			routeGET(r, "/pairing-codes", s.handleAdminListPairingCodes)
		})

		r.Group(func(r chi.Router) {
			r.Use(s.requireRole(store.RoleOwner, store.RoleAdmin))
			routePATCH(r, "/approval-policy", s.handleAdminUpdateApprovalPolicy)
			routeGET(r, "/settings", s.handleAdminSettings)
			routePOST(r, "/users", s.handleAdminCreateUser)
			routePATCH(r, "/users/{userId}", s.handleAdminUpdateUser)
			routePOST(r, "/policies", s.handleAdminCreateAccessPolicy)
			routePATCH(r, "/policies/{policyId}", s.handleAdminUpdateAccessPolicy)
			routeDELETE(r, "/policies/{policyId}", s.handleAdminDeleteAccessPolicy)
			routePATCH(r, "/devices/{deviceId}", s.handleAdminUpdateDevice)
			routeDELETE(r, "/devices/{deviceId}", s.handleAdminDeleteDevice)
			routePOST(r, "/devices/{deviceId}/revoke", s.handleAdminRevokeDevice)
			routePOST(r, "/mobile-devices/{mobileDeviceId}/revoke", s.handleAdminRevokeMobileDevice)
			// Pairing-code issuance is an Admin operation. Consuming a code belongs
			// to the Connector pairing WebSocket, not to this control-plane group.
			routePOST(r, "/pairing-codes", s.handleAdminCreatePairingCode)
		})

		r.Group(func(r chi.Router) {
			r.Use(s.requireRole(store.RoleOwner))
			routeDELETE(r, "/users/{userId}", s.handleAdminDeleteUser)
		})
	})
}
