// Package dbtest selects an isolated database for the shared persistence tests.
package dbtest

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/deepseek/dsh-connect/server/internal/pgtest"
)

const dialectEnvironment = "DSH_CONNECT_TEST_DATABASE_DIALECT"

// NewDatabase returns an empty database for the selected dialect. PostgreSQL
// remains the default so direct go test invocations retain their behavior.
func NewDatabase(t *testing.T) string {
	t.Helper()
	switch os.Getenv(dialectEnvironment) {
	case "", "postgres", "postgresql":
		return pgtest.NewDatabase(t)
	case "sqlite":
		return "sqlite://" + filepath.Join(t.TempDir(), "dsh-connect-test.db")
	default:
		t.Fatalf("%s must be postgres or sqlite", dialectEnvironment)
		return ""
	}
}
