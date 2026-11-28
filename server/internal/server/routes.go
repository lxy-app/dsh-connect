package server

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (s *Server) routes() http.Handler {
	mux := chi.NewRouter()
	mux.MethodNotAllowed(serveMethodNotAllowed(mux))
	s.registerAPIRoutes(mux)

	// ServeMux canonicalizes escaped paths before routing; Chi deliberately does
	// not. Keep this catch-all outer mux only for the existing 308 redirects for
	// repeated slashes and dot segments. Chi owns every API route and method.
	canonical := http.NewServeMux()
	canonical.Handle("/", mux)
	return s.corsMiddleware(canonical)
}

func (s *Server) registerAPIRoutes(mux chi.Router) {
	s.adminRoutes(mux)
	s.mobileRoutes(mux)
	s.connectorRoutes(mux)
	s.bootstrapRoutes(mux)
}

func serveMethodNotAllowed(mux *chi.Mux) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Chi's default 405 has an empty body and repeated Allow fields. Match the
		// previous ServeMux response, including its single sorted Allow header.
		allowed := make([]string, 0, 9)
		for _, method := range []string{
			http.MethodConnect,
			http.MethodDelete,
			http.MethodGet,
			http.MethodHead,
			http.MethodOptions,
			http.MethodPatch,
			http.MethodPost,
			http.MethodPut,
			http.MethodTrace,
		} {
			if mux.Match(chi.NewRouteContext(), method, r.URL.EscapedPath()) {
				allowed = append(allowed, method)
			}
		}
		if len(allowed) == 0 {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Allow", strings.Join(allowed, ", "))
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
	}
}

func routeGET(mux chi.Router, pattern string, handler http.HandlerFunc) {
	routeMethod(mux, http.MethodGet, pattern, handler)
	// Go's ServeMux method patterns route HEAD to GET handlers as well.
	routeMethod(mux, http.MethodHead, pattern, handler)
}

func routePOST(mux chi.Router, pattern string, handler http.HandlerFunc) {
	routeMethod(mux, http.MethodPost, pattern, handler)
}

func routePATCH(mux chi.Router, pattern string, handler http.HandlerFunc) {
	routeMethod(mux, http.MethodPatch, pattern, handler)
}

func routeDELETE(mux chi.Router, pattern string, handler http.HandlerFunc) {
	routeMethod(mux, http.MethodDelete, pattern, handler)
}

func routeMethod(mux chi.Router, method, pattern string, handler http.HandlerFunc) {
	mux.With(unescapeRouteParams).Method(method, pattern, handler)
}

func unescapeRouteParams(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Chi v5.5 populates Request.PathValue but captures values from RawPath.
		// ServeMux captures decoded segments, so decode each value exactly once
		// before existing handlers consume it.
		if routeContext := chi.RouteContext(r.Context()); routeContext != nil {
			for _, key := range routeContext.URLParams.Keys {
				value := r.PathValue(key)
				decoded, err := url.PathUnescape(value)
				if err == nil {
					r.SetPathValue(key, decoded)
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}
