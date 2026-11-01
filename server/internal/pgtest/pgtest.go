// Package pgtest provisions throwaway PostgreSQL databases for tests.
//
// It drives the Docker CLI directly instead of importing a Go container
// library: the repository already requires Docker for local development, and a
// single ssh-free `docker run` keeps the test dependency surface small.
package pgtest

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const (
	defaultImage  = "docker.m.daocloud.io/library/postgres:18"
	defaultUser   = "dsh"
	defaultPass   = "dsh"
	startupBudget = 60 * time.Second
)

// SkipUnlessAvailable skips the test when no PostgreSQL can be provisioned.
// CI can force failures instead of skips with DSH_CONNECT_REQUIRE_PG=1.
func SkipUnlessAvailable(t *testing.T) {
	t.Helper()
	if dsn := os.Getenv("DSH_CONNECT_TEST_DATABASE_URL"); dsn != "" {
		return
	}
	if _, err := exec.LookPath("docker"); err != nil {
		failOrSkip(t, "docker CLI not found; cannot start a temporary PostgreSQL")
	}
	if err := exec.Command("docker", "info").Run(); err != nil {
		failOrSkip(t, "docker daemon is not reachable; cannot start a temporary PostgreSQL")
	}
}

func failOrSkip(t *testing.T, message string) {
	t.Helper()
	if os.Getenv("DSH_CONNECT_REQUIRE_PG") == "1" {
		t.Fatalf("%s (DSH_CONNECT_REQUIRE_PG=1)", message)
	}
	t.Skip(message + "; set DSH_CONNECT_REQUIRE_PG=1 to fail instead")
}

var (
	sharedOnce    sync.Once
	sharedDSN     string
	sharedCleanup func()
	sharedError   error
)

// NewDatabase returns a DSN pointing at an empty, isolated database.
//
// When DSH_CONNECT_TEST_DATABASE_URL is set the test uses that server and gets a
// freshly created database on it. Otherwise one PostgreSQL container is shared
// by the whole test binary and every caller receives its own database.
func NewDatabase(t *testing.T) string {
	t.Helper()
	SkipUnlessAvailable(t)

	if base := os.Getenv("DSH_CONNECT_TEST_DATABASE_URL"); base != "" {
		return createDatabase(t, base)
	}

	sharedOnce.Do(func() {
		sharedDSN, sharedCleanup, sharedError = startContainer()
	})
	if sharedError != nil {
		t.Fatalf("start temporary PostgreSQL: %v", sharedError)
	}
	t.Cleanup(func() {})
	return createDatabase(t, sharedDSN)
}

// startContainer runs one PostgreSQL container and returns a maintenance DSN.
func startContainer() (string, func(), error) {
	name := "dsh-connect-test-" + randomSuffix()
	image := envOrDefault("DSH_CONNECT_TEST_PG_IMAGE", defaultImage)
	port, err := freePort()
	if err != nil {
		return "", nil, err
	}
	run := exec.Command(
		"docker", "run", "-d", "--rm",
		"--name", name,
		"-e", "POSTGRES_USER="+defaultUser,
		"-e", "POSTGRES_PASSWORD="+defaultPass,
		"-e", "POSTGRES_DB=postgres",
		"-p", fmt.Sprintf("127.0.0.1:%d:5432", port),
		image,
	)
	if output, err := run.CombinedOutput(); err != nil {
		return "", nil, fmt.Errorf("docker run: %w: %s", err, strings.TrimSpace(string(output)))
	}
	cleanup := func() {
		_ = exec.Command("docker", "rm", "-f", name).Run()
	}
	dsn := fmt.Sprintf("postgres://%s:%s@127.0.0.1:%d/postgres?sslmode=disable", defaultUser, defaultPass, port)
	if err := waitReady(dsn, startupBudget); err != nil {
		cleanup()
		return "", nil, err
	}
	return dsn, cleanup, nil
}

func waitReady(dsn string, budget time.Duration) error {
	deadline := time.Now().Add(budget)
	var lastErr error
	for time.Now().Before(deadline) {
		db, err := sql.Open("pgx", dsn)
		if err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			lastErr = db.PingContext(ctx)
			cancel()
			_ = db.Close()
			if lastErr == nil {
				return nil
			}
		} else {
			lastErr = err
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("PostgreSQL did not become ready within %s: %w", budget, lastErr)
}

// createDatabase provisions a uniquely named database and returns its DSN.
func createDatabase(t *testing.T, maintenanceDSN string) string {
	t.Helper()
	databaseName := "dsh_test_" + randomSuffix()
	if err := createDatabaseNamed(maintenanceDSN, databaseName); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		_ = dropDatabaseNamed(maintenanceDSN, databaseName)
	})
	return replacePath(maintenanceDSN, databaseName)
}

// CleanupContainer tears down the shared container. Call from TestMain.
func CleanupContainer() {
	if sharedCleanup != nil {
		sharedCleanup()
		sharedCleanup = nil
	}
}

func createDatabaseNamed(dsn, name string) error {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `CREATE DATABASE "`+name+`"`); err != nil {
		return err
	}
	return nil
}

func dropDatabaseNamed(dsn, name string) error {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// pgx cannot DROP a database with active sessions from another pool; the
	// per-test store is closed before cleanup runs, so this is best effort.
	_, err = db.ExecContext(ctx, `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`)
	return err
}

func replacePath(dsn, database string) string {
	parsed, err := url.Parse(dsn)
	if err != nil {
		// The DSN was already validated by the driver; fall back to a simple swap.
		return strings.Replace(dsn, "/postgres?", "/"+database+"?", 1)
	}
	parsed.Path = "/" + database
	return parsed.String()
}

func freePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func randomSuffix() string {
	buffer := make([]byte, 6)
	if _, err := rand.Read(buffer); err != nil {
		panic("pgtest: cannot read random bytes: " + err.Error())
	}
	return hex.EncodeToString(buffer)
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
