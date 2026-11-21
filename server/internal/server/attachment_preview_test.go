package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

const testPreviewWorkerToken = "shared-preview-test-token"

type attachmentPreviewFixture struct {
	environment *adminEnvironment
	connector   pairedConnector
	phone       protocol.MobileSessionResponse
	policy      store.AccessPolicyRecord
}

func newAttachmentPreviewFixture(t *testing.T, workerURL string, change ...func(*Config)) attachmentPreviewFixture {
	t.Helper()
	configure := func(config *Config) {
		config.PreviewWorkerURL = workerURL
		config.PreviewWorkerToken = testPreviewWorkerToken
		config.PreviewTimeout = 2 * time.Second
		config.MaxPreviewBytes = 1 << 20
		for _, apply := range change {
			apply(config)
		}
	}
	environment := newAttachmentEnvironment(t, configure)
	connector := pairConnector(t, environment.testEnvironment)
	phone := loginMobile(t, environment, testOwnerEmail, testOwnerPassword, "Preview iPhone")
	policy := allowMobileRead(t, environment, connector, phone)
	return attachmentPreviewFixture{environment: environment, connector: connector, phone: phone, policy: policy}
}

func (f attachmentPreviewFixture) declare(t *testing.T, id, name, mime string, data []byte, ready bool) string {
	t.Helper()
	now := nowUTC()
	if err := f.environment.server.store.UpsertSessionAttachments(context.Background(), []store.SessionAttachmentRecord{{
		ID: id, DeviceID: f.connector.deviceID, SessionID: "sess-1", WorkspaceID: "ws-1",
		Source: protocol.AttachmentSourceDeliverable, Kind: "file", DisplayName: name, Mime: mime,
		Bytes: int64(len(data)), State: protocol.AttachmentStateKnown, ExpiresAt: now.Add(time.Hour),
	}}, now); err != nil {
		t.Fatalf("declare preview attachment: %v", err)
	}
	if ready {
		status, body := uploadAttachment(t, f.environment.http.URL, f.connector.deviceToken, id, "sess-1", data, int64(len(data)), digestOf(data))
		if status != http.StatusOK {
			t.Fatalf("upload preview source status=%d body=%s", status, body)
		}
	}
	return digestOf(data)
}

func getAttachmentPreview(t *testing.T, baseURL, phoneToken, attachmentID, ifNoneMatch string) (*http.Response, []byte) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, baseURL+"/v1/mobile/attachments/"+attachmentID+"/preview", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+phoneToken)
	if ifNoneMatch != "" {
		request.Header.Set("If-None-Match", ifNoneMatch)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("preview attachment: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read preview response: %v", err)
	}
	return response, body
}

func assertPreviewPending(t *testing.T, response *http.Response, body []byte, state string) {
	t.Helper()
	if response.StatusCode != http.StatusAccepted || response.Header.Get("Retry-After") != "1" {
		t.Fatalf("pending status=%d Retry-After=%q body=%s", response.StatusCode, response.Header.Get("Retry-After"), body)
	}
	var pending struct {
		State        string `json:"state"`
		RetryAfterMS int    `json:"retryAfterMs"`
	}
	decodeTestJSON(t, body, &pending)
	if pending.State != state || pending.RetryAfterMS != 1000 {
		t.Fatalf("pending response=%+v", pending)
	}
}

func waitForCompletedPreview(t *testing.T, fixture attachmentPreviewFixture, attachmentID string) (*http.Response, []byte) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		response, body := getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, "")
		if response.StatusCode != http.StatusAccepted {
			return response, body
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("preview did not leave its pending state")
	return nil, nil
}

func TestMobileAttachmentPDFPreviewDirectAndOriginalDownloadUnchanged(t *testing.T) {
	fixture := newAttachmentPreviewFixture(t, "")
	const attachmentID = "att_pdfpreview111111"
	pdf := []byte("%PDF-1.7\noriginal-pdf-body")
	sha := fixture.declare(t, attachmentID, "report.pdf", "application/pdf", pdf, true)

	response, body := getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, "")
	if response.StatusCode != http.StatusOK || !bytes.Equal(body, pdf) {
		t.Fatalf("PDF preview status=%d body=%q", response.StatusCode, body)
	}
	if response.Header.Get("Content-Type") != "application/pdf" || response.Header.Get("Content-Disposition") != "inline" || response.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("PDF preview headers=%v", response.Header)
	}
	if response.Header.Get("Cache-Control") != "private, max-age=300" || response.Header.Get("ETag") != `"`+sha+`"` {
		t.Fatalf("PDF cache headers=%v", response.Header)
	}
	etag := response.Header.Get("ETag")
	response, body = getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, etag)
	if response.StatusCode != http.StatusNotModified || len(body) != 0 {
		t.Fatalf("PDF revalidation status=%d body=%q", response.StatusCode, body)
	}

	// The preview route does not alter original bytes or its download semantics.
	response, body = getAttachment(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, "")
	if response.StatusCode != http.StatusOK || !bytes.Equal(body, pdf) || response.Header.Get("Content-Disposition") != `attachment; filename="report.pdf"` {
		t.Fatalf("original download status=%d headers=%v body=%q", response.StatusCode, response.Header, body)
	}

	// An explicit PDF MIME wins over a misleading Office-looking display suffix.
	const mimePDFID = "att_pdfmime11111111"
	fixture.declare(t, mimePDFID, "misleading.docx", "application/pdf", pdf, true)
	response, body = getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, mimePDFID, "")
	if response.StatusCode != http.StatusOK || !bytes.Equal(body, pdf) {
		t.Fatalf("MIME PDF preview status=%d body=%q", response.StatusCode, body)
	}

	disabled := false
	if _, err := fixture.environment.server.store.UpdateAccessPolicy(context.Background(), fixture.policy.PolicyID, fixture.policy.Revision, store.AccessPolicyUpdate{Enabled: &disabled}); err != nil {
		t.Fatal(err)
	}
	// A previously cached client may present If-None-Match after revocation; the
	// authorization gate must run before ServeContent can turn it into a 304.
	response, body = getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, etag)
	assertErrorResponse(t, response.StatusCode, body, http.StatusForbidden, protocol.CodeForbidden)
}

func TestMobileAttachmentOfficePreviewFetchSingleflightCacheAndRetryHeaders(t *testing.T) {
	office := []byte("authorized-docx-original-bytes")
	converted := []byte("%PDF-1.7\nconverted-office-preview")
	workerStarted := make(chan struct{})
	releaseWorker := make(chan struct{})
	var startedOnce sync.Once
	var calls atomic.Int32
	worker := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if request.Header.Get("Authorization") != "Bearer "+testPreviewWorkerToken || request.Header.Get("X-DSH-Preview-Extension") != "docx" {
			t.Errorf("unexpected preview Worker headers: %v", request.Header)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil || !bytes.Equal(body, office) {
			t.Errorf("preview Worker input=%q err=%v", body, err)
		}
		startedOnce.Do(func() { close(workerStarted) })
		<-releaseWorker
		response.Header().Set("Content-Type", "application/pdf")
		_, _ = response.Write(converted)
	}))
	defer worker.Close()
	fixture := newAttachmentPreviewFixture(t, worker.URL)
	const attachmentID = "att_docxpreview11111"
	sha := fixture.declare(t, attachmentID, "roadmap.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", office, false)

	// The first preview uses the original attachment fetch lifecycle, not a new
	// desktop file path or a separate authorization mechanism.
	response, body := getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, "")
	assertPreviewPending(t, response, body, protocol.AttachmentStateFetching)
	command, reply := readConnectorCommand(t, fixture.connector.connection, protocol.MethodSessionAttachmentFetch)
	var params map[string]any
	if err := json.Unmarshal(command.Params, &params); err != nil {
		t.Fatal(err)
	}
	if params["attachmentId"] != attachmentID || params["sessionId"] != "sess-1" || params["workspaceId"] != "ws-1" {
		t.Fatalf("fetch params=%v", params)
	}
	status, uploadBody := uploadAttachment(t, fixture.environment.http.URL, fixture.connector.deviceToken, attachmentID, "sess-1", office, int64(len(office)), sha)
	if status != http.StatusOK {
		t.Fatalf("upload status=%d body=%s", status, uploadBody)
	}
	reply(map[string]any{"status": "ready", "bytes": len(office), "sha256": sha})

	response, body = getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, "")
	assertPreviewPending(t, response, body, "converting")
	select {
	case <-workerStarted:
	case <-time.After(time.Second):
		t.Fatal("conversion Worker was not called")
	}
	// A concurrent request joins the same derived key instead of converting twice.
	response, body = getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, "")
	assertPreviewPending(t, response, body, "converting")
	if calls.Load() != 1 {
		t.Fatalf("in-flight conversions=%d", calls.Load())
	}
	close(releaseWorker)
	response, body = waitForCompletedPreview(t, fixture, attachmentID)
	if response.StatusCode != http.StatusOK || !bytes.Equal(body, converted) {
		t.Fatalf("Office preview status=%d body=%q", response.StatusCode, body)
	}
	key := attachmentPreviewKey(sha)
	if response.Header.Get("Content-Type") != "application/pdf" || response.Header.Get("Content-Disposition") != "inline" || response.Header.Get("ETag") != `"`+key+`"` {
		t.Fatalf("Office preview headers=%v", response.Header)
	}
	cachedPath := fixture.environment.server.previewCache.path(key)
	cached, err := os.ReadFile(cachedPath)
	if err != nil || !bytes.Equal(cached, converted) {
		t.Fatalf("cached preview path=%q bytes=%q err=%v", cachedPath, cached, err)
	}

	response, body = getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, "")
	if response.StatusCode != http.StatusOK || !bytes.Equal(body, converted) || calls.Load() != 1 {
		t.Fatalf("cached preview status=%d calls=%d body=%q", response.StatusCode, calls.Load(), body)
	}
	response, body = getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, `"`+key+`"`)
	if response.StatusCode != http.StatusNotModified || len(body) != 0 || calls.Load() != 1 {
		t.Fatalf("cached revalidation status=%d calls=%d body=%q", response.StatusCode, calls.Load(), body)
	}
	row, err := fixture.environment.server.store.SessionAttachment(context.Background(), attachmentID)
	if err != nil || row.State != protocol.AttachmentStateReady || row.SHA256 != sha || row.ErrorCode != "" {
		t.Fatalf("original row changed during conversion: %+v err=%v", row, err)
	}
	response, body = getAttachment(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, "")
	if response.StatusCode != http.StatusOK || !bytes.Equal(body, office) {
		t.Fatalf("original Office download regressed: status=%d body=%q", response.StatusCode, body)
	}
}

func TestMobileAttachmentPreviewUnavailableUnsupportedAndManualFailureRetry(t *testing.T) {
	t.Run("unavailable and unsupported", func(t *testing.T) {
		fixture := newAttachmentPreviewFixture(t, "")
		const officeID = "att_noworker1111111"
		fixture.declare(t, officeID, "deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", []byte("pptx"), true)
		response, body := getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, officeID, "")
		assertErrorResponse(t, response.StatusCode, body, http.StatusServiceUnavailable, protocol.CodePreviewUnavailable)

		const textID = "att_plaintext111111"
		fixture.declare(t, textID, "notes.txt", "text/plain", []byte("plain"), false)
		response, body = getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, textID, "")
		assertErrorResponse(t, response.StatusCode, body, http.StatusUnsupportedMediaType, protocol.CodePreviewUnsupported)
		row, err := fixture.environment.server.store.SessionAttachment(context.Background(), textID)
		if err != nil || row.State != protocol.AttachmentStateKnown {
			t.Fatalf("unsupported format unexpectedly started a fetch: %+v err=%v", row, err)
		}
	})

	t.Run("failed conversion is visible then manually retryable", func(t *testing.T) {
		var calls atomic.Int32
		worker := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			if calls.Add(1) == 1 {
				response.WriteHeader(http.StatusUnprocessableEntity)
				_, _ = response.Write([]byte("private Worker failure details"))
				return
			}
			_, _ = response.Write([]byte("%PDF-retry-success"))
		}))
		defer worker.Close()
		fixture := newAttachmentPreviewFixture(t, worker.URL)
		const attachmentID = "att_failedpreview111"
		sha := fixture.declare(t, attachmentID, "sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", []byte("xlsx-source"), true)
		response, body := getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, "")
		assertPreviewPending(t, response, body, "converting")
		response, body = waitForCompletedPreview(t, fixture, attachmentID)
		assertErrorResponse(t, response.StatusCode, body, http.StatusConflict, protocol.CodePreviewFailed)
		if bytes.Contains(body, []byte("private Worker failure details")) {
			t.Fatalf("Worker error details leaked: %s", body)
		}
		time.Sleep(30 * time.Millisecond)
		if calls.Load() != 1 {
			t.Fatalf("conversion retried in background: calls=%d", calls.Load())
		}
		row, err := fixture.environment.server.store.SessionAttachment(context.Background(), attachmentID)
		if err != nil || row.State != protocol.AttachmentStateReady || row.SHA256 != sha || row.ErrorCode != "" {
			t.Fatalf("conversion failure polluted original state: %+v err=%v", row, err)
		}

		response, body = getAttachmentPreview(t, fixture.environment.http.URL, fixture.phone.AccessToken, attachmentID, "")
		assertPreviewPending(t, response, body, "converting")
		response, body = waitForCompletedPreview(t, fixture, attachmentID)
		if response.StatusCode != http.StatusOK || !bytes.Equal(body, []byte("%PDF-retry-success")) || calls.Load() != 2 {
			t.Fatalf("manual retry status=%d calls=%d body=%q", response.StatusCode, calls.Load(), body)
		}
	})
}

func TestPreviewServerConfigDefaultsAndValidation(t *testing.T) {
	t.Parallel()
	config, err := (Config{BootstrapToken: "token"}).withDefaults()
	if err != nil {
		t.Fatal(err)
	}
	if config.PreviewTimeout != 90*time.Second || config.MaxPreviewBytes != 50<<20 || config.PreviewWorkerURL != "" {
		t.Fatalf("preview defaults=%+v", config)
	}
	if _, err := (Config{BootstrapToken: "token", PreviewWorkerURL: "http://127.0.0.1:8788"}).withDefaults(); err == nil {
		t.Fatal("configured Worker URL without shared token must fail")
	}
	if _, err := (Config{BootstrapToken: "token", PreviewTimeout: -time.Second}).withDefaults(); err == nil {
		t.Fatal("negative preview timeout must fail")
	}
	if _, err := (Config{BootstrapToken: "token", MaxPreviewBytes: -1}).withDefaults(); err == nil {
		t.Fatal("negative preview byte cap must fail")
	}
}
