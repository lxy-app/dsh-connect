package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAdminSPA(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>admin</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("console.log('admin')"), 0o644); err != nil {
		t.Fatal(err)
	}

	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = io.WriteString(w, r.URL.Path)
	})
	handler, err := WithAdminSPA(api, dir)
	if err != nil {
		t.Fatalf("WithAdminSPA: %v", err)
	}

	t.Run("root serves index", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
		if response.Code != http.StatusOK || response.Body.String() != "<html>admin</html>" {
			t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
		}
		if cache := response.Header().Get("Cache-Control"); cache != "no-cache" {
			t.Fatalf("index Cache-Control=%q", cache)
		}
	})

	t.Run("React route falls back to index", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/users", nil))
		if response.Code != http.StatusOK || response.Body.String() != "<html>admin</html>" {
			t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
		}
	})

	t.Run("fingerprinted asset is served with immutable cache", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/assets/app.js", nil))
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "console.log") {
			t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
		}
		if cache := response.Header().Get("Cache-Control"); !strings.Contains(cache, "immutable") {
			t.Fatalf("asset Cache-Control=%q", cache)
		}
	})

	t.Run("missing asset does not return HTML", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/assets/missing.js", nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
		}
	})

	t.Run("API stays on original handler", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/admin/auth/me", nil))
		if response.Code != http.StatusTeapot || response.Body.String() != "/v1/admin/auth/me" {
			t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
		}
	})

	t.Run("static paths reject writes", func(t *testing.T) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/users", nil))
		if response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status=%d", response.Code)
		}
	})
}

func TestAdminSPARequiresBuiltIndex(t *testing.T) {
	if _, err := WithAdminSPA(http.NotFoundHandler(), t.TempDir()); err == nil {
		t.Fatal("expected a missing index.html error")
	}
}
