package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	connectserver "github.com/deepseek/dsh-connect/server/internal/server"
)

func main() {
	bootstrapToken := os.Getenv("DSH_CONNECT_BOOTSTRAP_TOKEN")
	if bootstrapToken == "" {
		log.Fatal("DSH_CONNECT_BOOTSTRAP_TOKEN must be set; no unauthenticated default is provided")
	}
	address := envOrDefault("DSH_CONNECT_LISTEN_ADDR", "127.0.0.1:8787")
	certFile := os.Getenv("DSH_CONNECT_TLS_CERT_FILE")
	keyFile := os.Getenv("DSH_CONNECT_TLS_KEY_FILE")
	if (certFile == "") != (keyFile == "") {
		log.Fatal("DSH_CONNECT_TLS_CERT_FILE and DSH_CONNECT_TLS_KEY_FILE must be set together")
	}
	serverURL := os.Getenv("DSH_CONNECT_SERVER_URL")
	if serverURL == "" {
		scheme := "http"
		if certFile != "" {
			scheme = "https"
		}
		host := address
		if strings.HasPrefix(host, ":") {
			host = "127.0.0.1" + host
		}
		serverURL = scheme + "://" + host
	}

	startupContext, cancelStartup := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelStartup()
	server, err := connectserver.New(startupContext, connectserver.Config{
		BootstrapToken:          bootstrapToken,
		DatabaseURL:             os.Getenv("DSH_CONNECT_DATABASE_URL"),
		ServerURL:               serverURL,
		AdminOrigin:             os.Getenv("DSH_CONNECT_ADMIN_ORIGIN"),
		MobilePairingCodeTTL:    envDuration("DSH_CONNECT_MOBILE_PAIRING_TTL", 5*time.Minute),
		MobileAccessTokenTTL:    envDuration("DSH_CONNECT_MOBILE_ACCESS_TTL", 15*time.Minute),
		MobileRefreshTokenTTL:   envDuration("DSH_CONNECT_MOBILE_REFRESH_TTL", 30*24*time.Hour),
		AttachmentsMode:         envOrDefault("DSH_CONNECT_ATTACHMENTS", "read"),
		MaxAttachmentBytes:      envInt64("DSH_CONNECT_MAX_ATTACHMENT_BYTES", 20<<20),
		MaxAttachmentStoreBytes: envInt64("DSH_CONNECT_MAX_ATTACHMENT_STORE_BYTES", 2<<30),
		AttachmentTTL:           envDuration("DSH_CONNECT_ATTACHMENT_TTL", 7*24*time.Hour),
		AttachmentDir:           os.Getenv("DSH_CONNECT_ATTACHMENT_DIR"),
		BootstrapOwnerEmail:     os.Getenv("DSH_CONNECT_BOOTSTRAP_OWNER_EMAIL"),
		BootstrapOwnerPassword:  os.Getenv("DSH_CONNECT_BOOTSTRAP_OWNER_PASSWORD"),
		BootstrapOwnerName:      os.Getenv("DSH_CONNECT_BOOTSTRAP_OWNER_NAME"),
	})
	if err != nil {
		log.Fatalf("initialize server: %v", err)
	}
	defer server.Close()

	handler := server.Handler()
	if adminDir := os.Getenv("DSH_CONNECT_ADMIN_DIR"); adminDir != "" {
		handler, err = connectserver.WithAdminSPA(handler, adminDir)
		if err != nil {
			log.Fatalf("initialize Web Admin: %v", err)
		}
		log.Printf("DSH Connect Web Admin served from %s", adminDir)
	}

	httpServer := &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	serveErrors := make(chan error, 1)
	go func() {
		log.Printf("DSH Connect Server listening on %s", address)
		if certFile != "" {
			serveErrors <- httpServer.ListenAndServeTLS(certFile, keyFile)
			return
		}
		serveErrors <- httpServer.ListenAndServe()
	}()

	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case err := <-serveErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
		return
	case <-signalContext.Done():
		log.Printf("shutdown requested")
	}

	server.Close()
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownContext); err != nil {
		log.Printf("graceful shutdown: %v", err)
		_ = httpServer.Close()
	}
	if err := <-serveErrors; err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("serve during shutdown: %v", err)
	}
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func envDuration(name string, fallback time.Duration) time.Duration {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value <= 0 {
		log.Fatalf("%s must be a positive Go duration, got %q", name, raw)
	}
	return value
}

func envInt64(name string, fallback int64) int64 {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		log.Fatalf("%s must be a positive integer, got %q", name, raw)
	}
	return value
}
