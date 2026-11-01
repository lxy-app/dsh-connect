package server

import (
	"bytes"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// WithAdminSPA serves the built Web Admin from dir while preserving all API
// routes on the same origin. Extensionless paths fall back to index.html so
// React Router routes continue to work after a browser refresh.
func WithAdminSPA(api http.Handler, dir string) (http.Handler, error) {
	indexPath := filepath.Join(dir, "index.html")
	index, err := os.ReadFile(indexPath)
	if err != nil {
		return nil, fmt.Errorf("read admin index: %w", err)
	}
	indexInfo, err := os.Stat(indexPath)
	if err != nil {
		return nil, fmt.Errorf("stat admin index: %w", err)
	}
	files := http.FileServer(http.Dir(dir))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1" || strings.HasPrefix(r.URL.Path, "/v1/") {
			api.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}

		cleanPath := path.Clean("/" + r.URL.Path)
		name := strings.TrimPrefix(cleanPath, "/")
		if name != "" && fs.ValidPath(name) {
			info, statErr := os.Stat(filepath.Join(dir, filepath.FromSlash(name)))
			if statErr == nil && info.Mode().IsRegular() {
				if strings.HasPrefix(cleanPath, "/assets/") {
					// Vite fingerprints files under assets, so they are safe to cache.
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		if path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, "index.html", indexInfo.ModTime(), bytes.NewReader(index))
	}), nil
}
