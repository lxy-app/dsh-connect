package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

type adminContextKey struct{}

// adminActor is the authenticated operator behind a management request.
type adminActor struct {
	User      store.User
	ViaBearer bool
}

// adminAuth authenticates management requests in two ways:
//
//  1. The bootstrap bearer token, used by automation and the debug CLI. It acts
//     as a synthetic owner with full access.
//  2. A browser login session token issued by /v1/admin/auth/login.
func (s *Server) adminAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok || token == "" {
			writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "bearer token required", false))
			return
		}
		if s.config.BootstrapToken != "" && tokensEqual(token, s.config.BootstrapToken) {
			actor := adminActor{
				ViaBearer: true,
				User: store.User{
					ID:          "bootstrap",
					Email:       "bootstrap@local",
					DisplayName: "Bootstrap Token",
					Role:        store.RoleOwner,
					Status:      store.UserStatusActive,
					CreatedAt:   nowUTC(),
					UpdatedAt:   nowUTC(),
				},
			}
			next(w, r.WithContext(context.WithValue(r.Context(), adminContextKey{}, actor)))
			return
		}
		user, err := s.store.AdminSessionUser(r.Context(), token, nowUTC())
		if err != nil {
			writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "session token is invalid or expired", false))
			return
		}
		actor := adminActor{User: user}
		next(w, r.WithContext(context.WithValue(r.Context(), adminContextKey{}, actor)))
	}
}

// requireRole guards a handler behind a minimum role.
func (s *Server) requireRole(roles ...string) func(http.HandlerFunc) http.HandlerFunc {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[role] = struct{}{}
	}
	return func(next http.HandlerFunc) http.HandlerFunc {
		return s.adminAuth(func(w http.ResponseWriter, r *http.Request) {
			actor, ok := adminFromContext(r.Context())
			if !ok {
				writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "authentication required", false))
				return
			}
			if _, permitted := allowed[actor.User.Role]; !permitted {
				writeAPIError(w, protocol.NewError(protocol.CodeForbidden, "role "+actor.User.Role+" cannot perform this action", false))
				return
			}
			next(w, r)
		})
	}
}

func adminFromContext(ctx context.Context) (adminActor, bool) {
	actor, ok := ctx.Value(adminContextKey{}).(adminActor)
	return actor, ok
}

// corsMiddleware allows the Vite dev server to call the API from a browser.
// Only the configured origin is echoed; wildcard CORS is deliberately avoided
// because these endpoints accept credentialed requests.
func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && s.originAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) originAllowed(origin string) bool {
	if s.config.AdminOrigin != "" {
		for _, allowed := range strings.Split(s.config.AdminOrigin, ",") {
			if strings.EqualFold(strings.TrimSpace(allowed), origin) {
				return true
			}
		}
		return false
	}
	// Development default: any loopback origin (Vite picks arbitrary ports).
	return strings.HasPrefix(origin, "http://127.0.0.1:") ||
		strings.HasPrefix(origin, "http://localhost:") ||
		strings.HasPrefix(origin, "https://127.0.0.1:") ||
		strings.HasPrefix(origin, "https://localhost:")
}

// auditActor records who performed a management action.
func auditActor(r *http.Request) string {
	actor, ok := adminFromContext(r.Context())
	if !ok {
		return "anonymous"
	}
	if actor.ViaBearer {
		return "bootstrap"
	}
	return "user:" + actor.User.ID
}

// sessionTTL exposes the configured admin session lifetime.
func (s *Server) sessionTTL() time.Duration {
	return s.config.AdminSessionTTL
}

var errNoActor = errors.New("no authenticated admin actor")
