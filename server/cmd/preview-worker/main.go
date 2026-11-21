package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/preview"
)

func main() {
	worker, err := preview.NewWorker(preview.WorkerConfig{
		Token:       os.Getenv("DSH_CONNECT_PREVIEW_WORKER_TOKEN"),
		MaxBytes:    envInt64("DSH_CONNECT_MAX_PREVIEW_BYTES", 50<<20),
		Timeout:     envDuration("DSH_CONNECT_PREVIEW_TIMEOUT", 90*time.Second),
		Concurrency: envInt("DSH_CONNECT_PREVIEW_CONCURRENCY", 2),
		Soffice:     os.Getenv("DSH_CONNECT_PREVIEW_SOFFICE"),
	})
	if err != nil {
		log.Fatalf("initialize preview Worker: %v", err)
	}
	address := envOrDefault("DSH_CONNECT_PREVIEW_LISTEN_ADDR", "127.0.0.1:8788")
	httpServer := &http.Server{
		Addr:              address,
		Handler:           worker.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	serveErrors := make(chan error, 1)
	go func() {
		log.Printf("DSH Connect preview Worker listening on %s", address)
		serveErrors <- httpServer.ListenAndServe()
	}()

	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case err := <-serveErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve preview Worker: %v", err)
		}
		return
	case <-signalContext.Done():
	}
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownContext); err != nil {
		_ = httpServer.Close()
	}
	if err := <-serveErrors; err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("preview Worker shutdown: %v", err)
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
		log.Fatalf("%s must be a positive Go duration", name)
	}
	return value
}

func envInt(name string, fallback int) int {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		log.Fatalf("%s must be a positive integer", name)
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
		log.Fatalf("%s must be a positive integer", name)
	}
	return value
}
