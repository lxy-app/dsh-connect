package store

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestSQLiteConnectionPragmasSurviveReconnect(t *testing.T) {
	dsn := "sqlite://" + filepath.Join(t.TempDir(), "store.db")
	persistent, err := Open(context.Background(), dsn)
	if err != nil {
		t.Fatalf("open sqlite store: %v", err)
	}
	defer persistent.Close()

	if got := persistent.db.Stats().MaxOpenConnections; got != 1 {
		t.Fatalf("sqlite max open connections=%d; want 1", got)
	}
	assertSQLitePragmas(t, persistent)

	// No idle connection is retained after this point. Every subsequent query
	// must receive the same connection-local pragmas from the driver DSN.
	persistent.db.SetMaxIdleConns(0)
	assertSQLitePragmas(t, persistent)
	assertSQLitePragmas(t, persistent)
}

func assertSQLitePragmas(t *testing.T, persistent *Store) {
	t.Helper()
	var journalMode string
	if err := persistent.db.QueryRow("PRAGMA journal_mode").Scan(&journalMode); err != nil {
		t.Fatalf("read journal_mode: %v", err)
	}
	if !strings.EqualFold(journalMode, "wal") {
		t.Fatalf("journal_mode=%q; want wal", journalMode)
	}
	for _, test := range []struct {
		name string
		want int
	}{
		{name: "foreign_keys", want: 1},
		{name: "busy_timeout", want: 5000},
		{name: "synchronous", want: 2}, // FULL
	} {
		var got int
		if err := persistent.db.QueryRow("PRAGMA " + test.name).Scan(&got); err != nil {
			t.Fatalf("read %s: %v", test.name, err)
		}
		if got != test.want {
			t.Fatalf("%s=%d; want %d", test.name, got, test.want)
		}
	}
}

func TestSQLiteDataSourceNamePreservesExistingQuery(t *testing.T) {
	dsn, err := sqliteDataSourceName("file:store.db?mode=rwc")
	if err != nil {
		t.Fatalf("build sqlite DSN: %v", err)
	}
	if !strings.HasPrefix(dsn, "file:store.db?mode=rwc&_pragma=") {
		t.Fatalf("sqlite DSN lost existing query: %q", dsn)
	}
	for _, pragma := range sqliteDriverPragmas {
		if !strings.Contains(dsn, pragma) {
			t.Fatalf("sqlite DSN %q missing %q", dsn, pragma)
		}
	}
	if _, err := sqliteDataSourceName(""); err == nil {
		t.Fatal("empty SQLite path must be rejected")
	}
}

func TestOpenRejectsUnsupportedDatabaseURL(t *testing.T) {
	if _, err := Open(context.Background(), "mysql://example.invalid/database"); err == nil {
		t.Fatal("unsupported database URL must be rejected")
	}
	if _, err := Open(context.Background(), "sqlite://"); err == nil {
		t.Fatal("empty SQLite database path must be rejected")
	}
}
