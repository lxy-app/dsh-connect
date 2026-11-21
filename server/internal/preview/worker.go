package preview

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultWorkerMaxBytes    = 50 << 20
	defaultWorkerTimeout     = 90 * time.Second
	defaultWorkerConcurrency = 2
	maxWorkerConcurrency     = 64
)

// WorkerConfig configures the isolated conversion process. Token is mandatory;
// there is no unauthenticated default.
type WorkerConfig struct {
	Token       string
	MaxBytes    int64
	Timeout     time.Duration
	Concurrency int
	// Soffice optionally selects the LibreOffice executable. Empty tries
	// "soffice" and then "libreoffice" on the explicit child PATH.
	Soffice string
}

type conversionFunc func(context.Context, string, string) error

// Worker accepts bytes only over its authenticated internal HTTP API.
type Worker struct {
	config  WorkerConfig
	convert conversionFunc
	slots   chan struct{}
}

func NewWorker(config WorkerConfig) (*Worker, error) {
	return newWorker(config, func(ctx context.Context, directory, extension string) error {
		return convertWithLibreOffice(ctx, config.Soffice, directory, extension)
	})
}

func newWorker(config WorkerConfig, convert conversionFunc) (*Worker, error) {
	if config.Token == "" {
		return nil, errors.New("DSH_CONNECT_PREVIEW_WORKER_TOKEN must be set")
	}
	if config.MaxBytes == 0 {
		config.MaxBytes = defaultWorkerMaxBytes
	}
	if config.Timeout == 0 {
		config.Timeout = defaultWorkerTimeout
	}
	if config.Concurrency == 0 {
		config.Concurrency = defaultWorkerConcurrency
	}
	if config.MaxBytes < 1 || config.Timeout <= 0 {
		return nil, errors.New("invalid preview Worker size or timeout configuration")
	}
	if config.Concurrency < 1 || config.Concurrency > maxWorkerConcurrency {
		return nil, errors.New("preview Worker concurrency must be between 1 and 64")
	}
	if convert == nil {
		return nil, errors.New("preview converter is required")
	}
	return &Worker{config: config, convert: convert, slots: make(chan struct{}, config.Concurrency)}, nil
}

func (w *Worker) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "text/plain; charset=utf-8")
		response.Header().Set("Cache-Control", "no-store")
		_, _ = response.Write([]byte("ok\n"))
	})
	mux.HandleFunc("POST /convert", w.handleConvert)
	return mux
}

func (w *Worker) handleConvert(response http.ResponseWriter, request *http.Request) {
	token, ok := workerBearerToken(request.Header.Get("Authorization"))
	if !ok || !workerTokensEqual(token, w.config.Token) {
		writeWorkerError(response, http.StatusUnauthorized, "unauthorized")
		return
	}
	extension := request.Header.Get(ExtensionHeader)
	if !SupportedOfficeExtension(extension) {
		writeWorkerError(response, http.StatusUnsupportedMediaType, "preview_unsupported")
		return
	}
	if mediaType := strings.TrimSpace(strings.Split(request.Header.Get("Content-Type"), ";")[0]); mediaType != "application/octet-stream" {
		writeWorkerError(response, http.StatusUnsupportedMediaType, "octet_stream_required")
		return
	}
	if request.ContentLength > w.config.MaxBytes {
		writeWorkerError(response, http.StatusRequestEntityTooLarge, "preview_too_large")
		return
	}

	ctx, cancel := context.WithTimeout(request.Context(), w.config.Timeout)
	defer cancel()
	// Bound both running LibreOffice processes and queue wait time. Requests do
	// not create unbounded background work when conversion capacity is saturated.
	select {
	case w.slots <- struct{}{}:
		defer func() { <-w.slots }()
	case <-ctx.Done():
		writeWorkerError(response, http.StatusGatewayTimeout, "conversion_timeout")
		return
	}
	directory, err := os.MkdirTemp("", "dsh-connect-preview-")
	if err != nil {
		writeWorkerError(response, http.StatusInternalServerError, "conversion_failed")
		return
	}
	defer func() { _ = os.RemoveAll(directory) }()

	inputPath := filepath.Join(directory, "source."+extension)
	input, err := os.OpenFile(inputPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		writeWorkerError(response, http.StatusInternalServerError, "conversion_failed")
		return
	}
	limited := http.MaxBytesReader(response, request.Body, w.config.MaxBytes+1)
	written, copyErr := io.Copy(input, limited)
	closeErr := input.Close()
	if copyErr != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(copyErr, &tooLarge) {
			writeWorkerError(response, http.StatusRequestEntityTooLarge, "preview_too_large")
			return
		}
		writeWorkerError(response, http.StatusBadRequest, "invalid_input")
		return
	}
	if closeErr != nil {
		writeWorkerError(response, http.StatusInternalServerError, "conversion_failed")
		return
	}
	if written == 0 {
		writeWorkerError(response, http.StatusBadRequest, "empty_input")
		return
	}
	if written > w.config.MaxBytes {
		writeWorkerError(response, http.StatusRequestEntityTooLarge, "preview_too_large")
		return
	}

	if err := w.convert(ctx, directory, extension); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			writeWorkerError(response, http.StatusGatewayTimeout, "conversion_timeout")
			return
		}
		writeWorkerError(response, http.StatusUnprocessableEntity, "conversion_failed")
		return
	}
	data, err := readConvertedPDF(filepath.Join(directory, "source.pdf"), w.config.MaxBytes)
	if err != nil {
		writeWorkerError(response, http.StatusUnprocessableEntity, "invalid_pdf")
		return
	}
	response.Header().Set("Content-Type", "application/pdf")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(data)
}

func convertWithLibreOffice(ctx context.Context, configuredBinary, directory, extension string) error {
	binary, err := libreOfficeBinary(configuredBinary)
	if err != nil {
		return conversionError(err)
	}
	command, err := newLibreOfficeCommand(ctx, binary, directory, extension)
	if err != nil {
		return conversionError(err)
	}
	if err := command.Run(); err != nil {
		return conversionError(err)
	}
	return nil
}

func libreOfficeBinary(configured string) (string, error) {
	if configured != "" {
		binary, err := exec.LookPath(configured)
		if err != nil {
			return "", errors.New("configured LibreOffice executable not found")
		}
		return binary, nil
	}
	binary, err := exec.LookPath("soffice")
	if err == nil {
		return binary, nil
	}
	binary, err = exec.LookPath("libreoffice")
	if err != nil {
		return "", errors.New("LibreOffice executable not found")
	}
	return binary, nil
}

func newLibreOfficeCommand(ctx context.Context, binary, directory, extension string) (*exec.Cmd, error) {
	profileDirectory := filepath.Join(directory, "profile")
	if err := os.Mkdir(profileDirectory, 0o700); err != nil {
		return nil, err
	}
	profileURL := (&url.URL{Scheme: "file", Path: profileDirectory}).String()
	inputPath := filepath.Join(directory, "source."+extension)
	command := exec.CommandContext(ctx, binary,
		"--headless",
		"--nologo",
		"--nodefault",
		"--nofirststartwizard",
		"--nolockcheck",
		"-env:UserInstallation="+profileURL,
		"--convert-to", "pdf",
		"--outdir", directory,
		inputPath,
	)
	command.Dir = directory
	// Never inherit the Worker process environment: it contains the shared token
	// and potentially other deployment secrets. LibreOffice gets only the small
	// allowlist it needs, with HOME and TMPDIR confined to this temporary job.
	command.Env = libreOfficeEnvironment(profileDirectory, directory)
	// Converter stdout/stderr may contain document details; never relay or log it.
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	return command, nil
}

func libreOfficeEnvironment(profileDirectory, jobDirectory string) []string {
	environment := []string{
		"HOME=" + profileDirectory,
		"TMPDIR=" + jobDirectory,
		"SAL_DISABLE_OPENCL=1",
	}
	for _, name := range []string{"PATH", "LANG"} {
		if value := os.Getenv(name); value != "" {
			environment = append(environment, name+"="+value)
		}
	}
	return environment
}

func readConvertedPDF(path string, maxBytes int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxBytes {
		return nil, errors.New("invalid converted PDF")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil || !ValidPDF(data, maxBytes) {
		return nil, errors.New("invalid converted PDF")
	}
	return data, nil
}

func workerBearerToken(header string) (string, bool) {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", false
	}
	return parts[1], true
}

func workerTokensEqual(left, right string) bool {
	leftHash := sha256.Sum256([]byte(left))
	rightHash := sha256.Sum256([]byte(right))
	return subtle.ConstantTimeCompare(leftHash[:], rightHash[:]) == 1
}

func writeWorkerError(response http.ResponseWriter, status int, code string) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(map[string]any{"error": map[string]string{"code": code}})
}
