package preview

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestOfficeExtensionAllowlist(t *testing.T) {
	t.Parallel()
	for _, extension := range []string{"doc", "docx", "ppt", "pptx", "xls", "xlsx"} {
		name := "Report." + strings.ToUpper(extension)
		actual, ok := OfficeExtension(name, "")
		if !ok || actual != extension || !SupportedOfficeExtension(actual) {
			t.Errorf("OfficeExtension(%q)=%q, %t", name, actual, ok)
		}
	}
	for _, name := range []string{"notes.txt", "archive.zip", "document.pdf", "no-extension", "docx"} {
		if extension, ok := OfficeExtension(name, ""); ok {
			t.Errorf("OfficeExtension(%q) unexpectedly allowed %q", name, extension)
		}
	}
	for mime, expected := range officeMIMES {
		actual, ok := OfficeExtension("download", mime+"; charset=binary")
		if !ok || actual != expected {
			t.Errorf("MIME %q mapped to %q, %t; want %q", mime, actual, ok, expected)
		}
	}
	if extension, ok := OfficeExtension("misleading.txt", "application/msword"); ok {
		t.Fatalf("explicit non-Office suffix unexpectedly mapped to %q", extension)
	}
}

func TestWorkerConfigRequiresTokenAndAppliesLimits(t *testing.T) {
	t.Parallel()
	if _, err := NewWorker(WorkerConfig{}); err == nil {
		t.Fatal("Worker without a shared token must not start")
	}
	worker, err := newWorker(WorkerConfig{Token: "shared-secret"}, func(context.Context, string, string) error { return nil })
	if err != nil {
		t.Fatalf("new Worker: %v", err)
	}
	if worker.config.MaxBytes != 50<<20 || worker.config.Timeout != 90*time.Second || worker.config.Concurrency != 2 || cap(worker.slots) != 2 {
		t.Fatalf("Worker defaults=%+v", worker.config)
	}
	if _, err := newWorker(WorkerConfig{Token: "shared-secret", MaxBytes: -1}, func(context.Context, string, string) error { return nil }); err == nil {
		t.Fatal("negative input limit must fail")
	}
	if _, err := newWorker(WorkerConfig{Token: "shared-secret", Timeout: -time.Second}, func(context.Context, string, string) error { return nil }); err == nil {
		t.Fatal("negative timeout must fail")
	}
	for _, concurrency := range []int{-1, 65} {
		if _, err := newWorker(WorkerConfig{Token: "shared-secret", Concurrency: concurrency}, func(context.Context, string, string) error { return nil }); err == nil {
			t.Fatalf("invalid concurrency %d must fail", concurrency)
		}
	}
}

func TestLibreOfficeCommandUsesConfiguredBinaryAndMinimalEnvironment(t *testing.T) {
	t.Setenv("DSH_CONNECT_PREVIEW_WORKER_TOKEN", "must-not-reach-converter")
	t.Setenv("HOME", "/desktop/private-home")
	t.Setenv("PATH", "/safe/bin")
	t.Setenv("LANG", "C.UTF-8")
	directory := t.TempDir()
	command, err := newLibreOfficeCommand(context.Background(), "/opt/LibreOffice/soffice", directory, "docx")
	if err != nil {
		t.Fatal(err)
	}
	if command.Path != "/opt/LibreOffice/soffice" || command.Args[0] != "/opt/LibreOffice/soffice" {
		t.Fatalf("configured executable was not used: path=%q args=%v", command.Path, command.Args)
	}
	environment := map[string]string{}
	for _, entry := range command.Env {
		name, value, ok := strings.Cut(entry, "=")
		if !ok {
			t.Fatalf("invalid child environment entry %q", entry)
		}
		environment[name] = value
	}
	if len(command.Env) != 5 || environment["HOME"] != filepath.Join(directory, "profile") || environment["TMPDIR"] != directory || environment["PATH"] != "/safe/bin" || environment["LANG"] != "C.UTF-8" || environment["SAL_DISABLE_OPENCL"] != "1" {
		t.Fatalf("child environment=%v", environment)
	}
	if _, leaked := environment["DSH_CONNECT_PREVIEW_WORKER_TOKEN"]; leaked || strings.Contains(strings.Join(command.Env, "\n"), "must-not-reach-converter") {
		t.Fatal("Worker token reached the conversion child environment")
	}
	for _, argument := range command.Args {
		if argument == "sh" || argument == "bash" || argument == "-c" {
			t.Fatalf("shell argument found in LibreOffice command: %v", command.Args)
		}
	}

	configured := filepath.Join(t.TempDir(), "custom-soffice")
	if err := os.WriteFile(configured, []byte("not executed"), 0o700); err != nil {
		t.Fatal(err)
	}
	binary, err := libreOfficeBinary(configured)
	if err != nil || binary != configured {
		t.Fatalf("configured binary=%q err=%v", binary, err)
	}
}

func TestWorkerHealthNeedsNoCredentialsOrSensitiveMetadata(t *testing.T) {
	t.Parallel()
	worker, err := newWorker(WorkerConfig{Token: "shared-secret"}, func(context.Context, string, string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	response := httptest.NewRecorder()
	worker.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "ok\n" || bytes.Contains(response.Body.Bytes(), []byte("shared-secret")) {
		t.Fatalf("health response status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestWorkerAuthenticatesAndUsesFixedSafeFilenames(t *testing.T) {
	t.Parallel()
	var calls atomic.Int32
	var temporaryDirectory string
	worker, err := newWorker(WorkerConfig{Token: "shared-secret", MaxBytes: 1024, Timeout: time.Second}, func(_ context.Context, directory, extension string) error {
		calls.Add(1)
		temporaryDirectory = directory
		if extension != "docx" {
			t.Errorf("extension=%q", extension)
		}
		entries, err := os.ReadDir(directory)
		if err != nil || len(entries) != 1 || entries[0].Name() != "source.docx" {
			t.Errorf("temporary entries=%v err=%v", entries, err)
		}
		input, err := os.ReadFile(filepath.Join(directory, "source.docx"))
		if err != nil || !bytes.Equal(input, []byte("authorized-office-bytes")) {
			t.Errorf("input=%q err=%v", input, err)
		}
		return os.WriteFile(filepath.Join(directory, "source.pdf"), []byte("%PDF-1.7\nconverted"), 0o600)
	})
	if err != nil {
		t.Fatal(err)
	}
	handler := worker.Handler()
	for _, token := range []string{"", "wrong-secret"} {
		request := httptest.NewRequest(http.MethodPost, "/convert", bytes.NewReader([]byte("ignored")))
		request.Header.Set(ExtensionHeader, "docx")
		request.Header.Set("Content-Type", "application/octet-stream")
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("token=%q status=%d", token, response.Code)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("unauthenticated request reached converter")
	}

	request := httptest.NewRequest(http.MethodPost, "/convert", bytes.NewReader([]byte("authorized-office-bytes")))
	request.Header.Set("Authorization", "Bearer shared-secret")
	request.Header.Set(ExtensionHeader, "docx")
	request.Header.Set("Content-Type", "application/octet-stream")
	// This display filename is deliberately hostile and must be ignored.
	request.Header.Set("X-Filename", "../../desktop/private/secret.docx")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !bytes.HasPrefix(response.Body.Bytes(), []byte("%PDF-")) || response.Header().Get("Content-Type") != "application/pdf" {
		t.Fatalf("conversion status=%d body=%q", response.Code, response.Body.String())
	}
	if calls.Load() != 1 || temporaryDirectory == "" {
		t.Fatalf("converter calls=%d", calls.Load())
	}
	if _, err := os.Stat(temporaryDirectory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary directory was not removed: %v", err)
	}
}

func TestWorkerRejectsUnsupportedExtensionsAndOversizedInput(t *testing.T) {
	t.Parallel()
	var calls atomic.Int32
	worker, err := newWorker(WorkerConfig{Token: "shared-secret", MaxBytes: 4, Timeout: time.Second}, func(context.Context, string, string) error {
		calls.Add(1)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, extension := range []string{"", ".docx", "DOCX", "exe", "pdf"} {
		request := httptest.NewRequest(http.MethodPost, "/convert", bytes.NewReader([]byte("doc")))
		request.Header.Set("Authorization", "Bearer shared-secret")
		request.Header.Set(ExtensionHeader, extension)
		request.Header.Set("Content-Type", "application/octet-stream")
		response := httptest.NewRecorder()
		worker.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("extension=%q status=%d", extension, response.Code)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/convert", bytes.NewReader([]byte("12345")))
	request.Header.Set("Authorization", "Bearer shared-secret")
	request.Header.Set(ExtensionHeader, "docx")
	request.Header.Set("Content-Type", "application/octet-stream")
	response := httptest.NewRecorder()
	worker.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized input status=%d body=%s", response.Code, response.Body.String())
	}
	if calls.Load() != 0 {
		t.Fatal("invalid requests reached converter")
	}
}

func TestWorkerBoundsConcurrentConversionProcesses(t *testing.T) {
	t.Parallel()
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	var active atomic.Int32
	var overlapped atomic.Bool
	worker, err := newWorker(WorkerConfig{Token: "shared-secret", MaxBytes: 1024, Timeout: time.Second, Concurrency: 1}, func(_ context.Context, directory, _ string) error {
		if active.Add(1) > 1 {
			overlapped.Store(true)
		}
		started <- struct{}{}
		<-release
		active.Add(-1)
		return os.WriteFile(filepath.Join(directory, "source.pdf"), []byte("%PDF-bound"), 0o600)
	})
	if err != nil {
		t.Fatal(err)
	}
	handler := worker.Handler()
	serve := func() <-chan *httptest.ResponseRecorder {
		result := make(chan *httptest.ResponseRecorder, 1)
		go func() {
			request := httptest.NewRequest(http.MethodPost, "/convert", bytes.NewReader([]byte("source")))
			request.Header.Set("Authorization", "Bearer shared-secret")
			request.Header.Set(ExtensionHeader, "docx")
			request.Header.Set("Content-Type", "application/octet-stream")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			result <- response
		}()
		return result
	}
	first := serve()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first conversion did not start")
	}
	second := serve()
	select {
	case <-started:
		t.Fatal("second conversion exceeded the concurrency limit")
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	for index, result := range []<-chan *httptest.ResponseRecorder{first, second} {
		select {
		case response := <-result:
			if response.Code != http.StatusOK {
				t.Fatalf("request %d status=%d body=%s", index, response.Code, response.Body.String())
			}
		case <-time.After(time.Second):
			t.Fatalf("request %d did not finish", index)
		}
	}
	if overlapped.Load() {
		t.Fatal("LibreOffice conversion processes overlapped despite concurrency=1")
	}
}

func TestWorkerQueueWaitHonorsConfiguredTimeout(t *testing.T) {
	t.Parallel()
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	worker, err := newWorker(WorkerConfig{Token: "shared-secret", MaxBytes: 1024, Timeout: 30 * time.Millisecond, Concurrency: 1}, func(_ context.Context, directory, _ string) error {
		calls.Add(1)
		close(started)
		<-release
		return os.WriteFile(filepath.Join(directory, "source.pdf"), []byte("%PDF-first"), 0o600)
	})
	if err != nil {
		t.Fatal(err)
	}
	serve := func(result chan<- *httptest.ResponseRecorder) {
		request := httptest.NewRequest(http.MethodPost, "/convert", bytes.NewReader([]byte("source")))
		request.Header.Set("Authorization", "Bearer shared-secret")
		request.Header.Set(ExtensionHeader, "docx")
		request.Header.Set("Content-Type", "application/octet-stream")
		response := httptest.NewRecorder()
		worker.Handler().ServeHTTP(response, request)
		result <- response
	}
	first := make(chan *httptest.ResponseRecorder, 1)
	go serve(first)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first conversion did not start")
	}
	second := make(chan *httptest.ResponseRecorder, 1)
	go serve(second)
	select {
	case response := <-second:
		if response.Code != http.StatusGatewayTimeout || calls.Load() != 1 {
			t.Fatalf("queued request status=%d calls=%d", response.Code, calls.Load())
		}
	case <-time.After(time.Second):
		t.Fatal("queued request did not honor its timeout")
	}
	close(release)
	select {
	case <-first:
	case <-time.After(time.Second):
		t.Fatal("active conversion did not finish")
	}
}

func TestWorkerValidatesOutputAndHonorsTimeout(t *testing.T) {
	t.Parallel()
	tests := map[string]struct {
		convert  conversionFunc
		expected int
	}{
		"missing output": {convert: func(context.Context, string, string) error { return nil }, expected: http.StatusUnprocessableEntity},
		"empty output": {convert: func(_ context.Context, directory, _ string) error {
			return os.WriteFile(filepath.Join(directory, "source.pdf"), nil, 0o600)
		}, expected: http.StatusUnprocessableEntity},
		"wrong signature": {convert: func(_ context.Context, directory, _ string) error {
			return os.WriteFile(filepath.Join(directory, "source.pdf"), []byte("not-a-pdf"), 0o600)
		}, expected: http.StatusUnprocessableEntity},
		"oversized output": {convert: func(_ context.Context, directory, _ string) error {
			return os.WriteFile(filepath.Join(directory, "source.pdf"), []byte("%PDF-too-large"), 0o600)
		}, expected: http.StatusUnprocessableEntity},
		"timeout": {convert: func(ctx context.Context, _, _ string) error {
			<-ctx.Done()
			return ctx.Err()
		}, expected: http.StatusGatewayTimeout},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			worker, err := newWorker(WorkerConfig{Token: "shared-secret", MaxBytes: 8, Timeout: 20 * time.Millisecond}, test.convert)
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/convert", bytes.NewReader([]byte("doc")))
			request.Header.Set("Authorization", "Bearer shared-secret")
			request.Header.Set(ExtensionHeader, "docx")
			request.Header.Set("Content-Type", "application/octet-stream")
			response := httptest.NewRecorder()
			worker.Handler().ServeHTTP(response, request)
			if response.Code != test.expected {
				t.Fatalf("status=%d body=%s, want %d", response.Code, response.Body.String(), test.expected)
			}
		})
	}
}

func TestClientRejectsWorkerErrorsInvalidPDFAndOversizedResponse(t *testing.T) {
	t.Parallel()
	tests := map[string]struct {
		status int
		body   []byte
	}{
		"worker error":      {status: http.StatusUnprocessableEntity, body: []byte("private conversion details")},
		"invalid PDF":       {status: http.StatusOK, body: []byte("not-a-pdf")},
		"oversized PDF":     {status: http.StatusOK, body: []byte("%PDF-12345")},
		"empty PDF":         {status: http.StatusOK, body: nil},
		"valid upper bound": {status: http.StatusOK, body: []byte("%PDF-12")},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			worker := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				response.WriteHeader(test.status)
				_, _ = response.Write(test.body)
			}))
			defer worker.Close()
			client, err := NewClient(worker.URL, "shared-secret", 7, time.Second)
			if err != nil {
				t.Fatal(err)
			}
			data, err := client.Convert(context.Background(), "docx", bytes.NewReader([]byte("source")))
			if name == "valid upper bound" {
				if err != nil || !bytes.Equal(data, test.body) {
					t.Fatalf("valid response data=%q err=%v", data, err)
				}
				return
			}
			if !errors.Is(err, ErrConversion) || data != nil {
				t.Fatalf("data=%q err=%v", data, err)
			}
		})
	}
}

func TestClientStreamsOnlyBytesAndAllowlistedExtension(t *testing.T) {
	t.Parallel()
	worker := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer shared-secret" || request.Header.Get(ExtensionHeader) != "pptx" || request.Header.Get("Content-Type") != "application/octet-stream" {
			t.Errorf("unexpected Worker headers: %+v", request.Header)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil || !bytes.Equal(body, []byte("source")) {
			t.Errorf("Worker body=%q err=%v", body, err)
		}
		response.Header().Set("Content-Type", "application/pdf")
		_, _ = response.Write([]byte("%PDF-ok"))
	}))
	defer worker.Close()
	client, err := NewClient(worker.URL, "shared-secret", 1024, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	data, err := client.Convert(context.Background(), "pptx", bytes.NewReader([]byte("source")))
	if err != nil || !bytes.Equal(data, []byte("%PDF-ok")) {
		t.Fatalf("Convert data=%q err=%v", data, err)
	}
	if _, err := client.Convert(context.Background(), "../docx", bytes.NewReader([]byte("source"))); !errors.Is(err, ErrConversion) {
		t.Fatalf("unsupported extension err=%v", err)
	}
}
