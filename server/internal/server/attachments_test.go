package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

// readConnectorCommand waits for one Server command and returns it together
// with a reply function, so a test can assert the parameters the Server sent
// before answering.
func readConnectorCommand(t *testing.T, connection *websocket.Conn, method string) (connectorCommandFrame, func(any)) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	messageType, data, err := connection.Read(ctx)
	if err != nil {
		t.Fatalf("read connector command: %v", err)
	}
	if messageType != websocket.MessageText {
		t.Fatal("connector command frame was not text")
	}
	var command connectorCommandFrame
	if err := json.Unmarshal(data, &command); err != nil {
		t.Fatalf("decode connector command: %v", err)
	}
	if command.Type != protocol.TypeCommand || command.Method != method {
		t.Fatalf("unexpected command type=%s method=%s, want %s", command.Type, command.Method, method)
	}
	reply := func(result any) {
		payload, err := json.Marshal(result)
		if err != nil {
			t.Fatalf("marshal command result: %v", err)
		}
		response, err := json.Marshal(protocol.Result{
			V: protocol.Version, Type: protocol.TypeResult, RequestID: command.RequestID, Result: payload,
		})
		if err != nil {
			t.Fatalf("marshal result frame: %v", err)
		}
		writeCtx, writeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer writeCancel()
		if err := connection.Write(writeCtx, websocket.MessageText, response); err != nil {
			t.Fatalf("write command result: %v", err)
		}
	}
	return command, reply
}

// uploadAttachment posts raw bytes the way the Connector does.
func uploadAttachment(
	t *testing.T,
	url, deviceToken, attachmentID, sessionID string,
	body []byte,
	declaredBytes int64,
	declaredSHA string,
) (int, []byte) {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, url+"/v1/connector/attachments/"+attachmentID, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build upload request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+deviceToken)
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set("X-DSH-Attachment-Session", sessionID)
	request.Header.Set("X-DSH-Attachment-Bytes", strconvFormat(declaredBytes))
	request.Header.Set("X-DSH-Attachment-Sha256", declaredSHA)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("upload attachment: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read upload response: %v", err)
	}
	return response.StatusCode, payload
}

func strconvFormat(value int64) string {
	return strconv.FormatInt(value, 10)
}

// getAttachment issues a download request with an optional If-None-Match value.
func getAttachment(t *testing.T, baseURL, phoneToken, attachmentID, ifNoneMatch string) (*http.Response, []byte) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, baseURL+"/v1/mobile/attachments/"+attachmentID, nil)
	if err != nil {
		t.Fatalf("build download request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+phoneToken)
	if ifNoneMatch != "" {
		request.Header.Set("If-None-Match", ifNoneMatch)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("download attachment: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read download response: %v", err)
	}
	return response, payload
}

func digestOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// newAttachmentEnvironment boots a server with an owner account and an isolated
// blob directory, so tests never write attachments into the repository.
func newAttachmentEnvironment(t *testing.T, change ...func(*Config)) *adminEnvironment {
	t.Helper()
	base := func(config *Config) {
		config.BootstrapOwnerEmail = testOwnerEmail
		config.BootstrapOwnerPassword = testOwnerPassword
		config.BootstrapOwnerName = "Test Owner"
		config.AttachmentDir = t.TempDir()
	}
	environment := newTestEnvironment(t, append([]func(*Config){base}, change...)...)
	return &adminEnvironment{testEnvironment: environment, ownerEmail: testOwnerEmail, ownerPassword: testOwnerPassword}
}

// TestMobileAttachmentLearnFetchUploadDownload walks the whole M1 loop: the
// Server learns a declaration from a transcript, asks the Connector for bytes,
// accepts the upload, then serves them with digest revalidation.
func TestMobileAttachmentLearnFetchUploadDownload(t *testing.T) {
	environment := newAttachmentEnvironment(t)
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	mobileCode := issueMobilePairingCode(t, environment, ownerToken, "")
	phone := pairMobile(t, environment, mobileCode.Code, "Attachment iPhone")
	grantID := grantMobileRead(t, environment, connector, phone)

	const attachmentID = "att_b7Qk2m9xT4pL0rVc8sN1"
	fileBytes := []byte("\x89PNG\r\n\x1a\n" + "fake-png-body")

	// A transcript declaring one delivered image teaches the Server the row.
	transcript := map[string]any{
		"messages": []map[string]any{
			{
				"id": "msg-1", "seq": 10, "role": "assistant", "text": "已生成架构图",
				"occurredAt": "2026-11-02T11:37:13Z",
				"attachments": []map[string]any{
					{
						"attachmentId": attachmentID, "kind": "image", "name": "architecture.png",
						"mime": "image/png", "bytes": len(fileBytes), "source": "deliverable", "state": "known",
					},
				},
			},
		},
		"hasMore": false, "active": false,
	}
	go func() {
		_ = answerCommand(connector.connection, protocol.MethodSessionTranscript, transcript)
	}()
	status, body := testRequest(t, http.MethodGet,
		environment.http.URL+"/v1/mobile/sessions/sess-1/messages?deviceId="+connector.deviceID+"&workspaceId=ws-1",
		phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("transcript status=%d body=%s", status, body)
	}
	var transcriptResponse protocol.MobileTranscriptResponse
	decodeTestJSON(t, body, &transcriptResponse)
	if len(transcriptResponse.Messages) != 1 || len(transcriptResponse.Messages[0].Attachments) != 1 {
		t.Fatalf("transcript did not carry the attachment: %+v", transcriptResponse.Messages)
	}
	learned := transcriptResponse.Messages[0].Attachments[0]
	if learned.AttachmentID != attachmentID || learned.State != protocol.AttachmentStateKnown || learned.Name != "architecture.png" {
		t.Fatalf("unexpected learned attachment: %+v", learned)
	}

	// The first download request triggers a Connector fetch and answers 202. The
	// request runs in a goroutine while this one reads the command, because the
	// download itself returns before the command is answered.
	type downloadResult struct {
		status int
		body   []byte
		header http.Header
	}
	downloads := make(chan downloadResult, 1)
	go func() {
		response, payload := getAttachment(t, environment.http.URL, phone.AccessToken, attachmentID, "")
		downloads <- downloadResult{status: response.StatusCode, body: payload, header: response.Header}
	}()
	command, reply := readConnectorCommand(t, connector.connection, protocol.MethodSessionAttachmentFetch)
	var params map[string]any
	if err := json.Unmarshal(command.Params, &params); err != nil {
		t.Fatalf("decode fetch params: %v", err)
	}
	if params["attachmentId"] != attachmentID || params["sessionId"] != "sess-1" || params["workspaceId"] != "ws-1" {
		t.Fatalf("unexpected fetch params: %+v", params)
	}
	pending := <-downloads
	if pending.status != http.StatusAccepted {
		t.Fatalf("first download status=%d body=%s", pending.status, pending.body)
	}

	// The Connector uploads the bytes before answering the command.
	status, body = uploadAttachment(
		t, environment.http.URL, connector.deviceToken, attachmentID, "sess-1",
		fileBytes, int64(len(fileBytes)), digestOf(fileBytes),
	)
	if status != http.StatusOK {
		t.Fatalf("upload status=%d body=%s", status, body)
	}
	reply(map[string]any{"status": "ready", "bytes": len(fileBytes), "sha256": digestOf(fileBytes), "mime": "image/png"})

	// A ready attachment serves its bytes with a digest ETag.
	response, served := getAttachment(t, environment.http.URL, phone.AccessToken, attachmentID, "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("download status=%d body=%s", response.StatusCode, served)
	}
	if !bytes.Equal(served, fileBytes) {
		t.Fatalf("served bytes mismatch: %q", served)
	}
	if got := response.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("missing nosniff header: %q", got)
	}
	etag := response.Header.Get("ETag")
	if etag == "" {
		t.Fatal("download response had no ETag")
	}

	// Revalidation: the same digest must not resend the body.
	response, _ = getAttachment(t, environment.http.URL, phone.AccessToken, attachmentID, etag)
	if response.StatusCode != http.StatusNotModified {
		t.Fatalf("revalidation status=%d, want 304", response.StatusCode)
	}

	// Revoking the grant closes the same URL immediately.
	status, body = testRequest(t, http.MethodDelete, environment.http.URL+"/v1/mobile/access/"+grantID, phone.AccessToken, nil)
	if status != http.StatusNoContent {
		t.Fatalf("revoke status=%d body=%s", status, body)
	}
	response, revoked := getAttachment(t, environment.http.URL, phone.AccessToken, attachmentID, "")
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("revoked download status=%d body=%s", response.StatusCode, revoked)
	}
}

// grantMobileRead requests read access from the phone and approves it on the
// desktop, returning the grant id.
func grantMobileRead(t *testing.T, environment *adminEnvironment, connector pairedConnector, phone protocol.MobileSessionResponse) string {
	t.Helper()
	allowUserAccess(t, environment, phone.User.ID, connector.deviceID, []string{"ws-1"}, []string{"read"})
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
		"deviceId": connector.deviceID, "workspaces": []string{"ws-1"}, "scopes": []string{"read"},
	})
	if status != http.StatusCreated {
		t.Fatalf("access request status=%d body=%s", status, body)
	}
	var requested protocol.MobileAccessGrant
	decodeTestJSON(t, body, &requested)
	decided := connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessDecide, map[string]any{
		"mobileDeviceId": phone.MobileDeviceID,
		"action":         "allow",
		"workspaces":     []string{"ws-1"},
		"scopes":         []string{"read"},
	})
	var grant protocol.MobileAccessGrant
	if err := json.Unmarshal(decided, &grant); err != nil {
		t.Fatalf("decode grant: %v", err)
	}
	if grant.Status != "active" {
		t.Fatalf("grant not active: %+v", grant)
	}
	return grant.GrantID
}

// TestMobileAttachmentRejectsUnknownWrongDeviceAndBadDigest covers the refusal
// paths that keep enumeration and forged bytes out.
func TestMobileAttachmentRejectsUnknownWrongDeviceAndBadDigest(t *testing.T) {
	environment := newAttachmentEnvironment(t, func(config *Config) {
		config.MaxAttachmentBytes = 32
	})
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	mobileCode := issueMobilePairingCode(t, environment, ownerToken, "")
	phone := pairMobile(t, environment, mobileCode.Code, "Reject iPhone")
	grantMobileRead(t, environment, connector, phone)

	const attachmentID = "att_a1b2c3d4e5f6g7h8"
	fileBytes := []byte("payload-bytes")
	transcript := map[string]any{
		"messages": []map[string]any{
			{
				"id": "msg-1", "seq": 5, "role": "assistant", "text": "文件",
				"occurredAt": "2026-11-02T11:37:13Z",
				"attachments": []map[string]any{
					{
						"attachmentId": attachmentID, "kind": "file", "name": "notes.txt",
						"mime": "text/plain", "bytes": len(fileBytes), "source": "deliverable", "state": "known",
					},
					{
						"attachmentId": "att_denied1111111111", "kind": "image", "name": "secret.png",
						"mime": "image/png", "bytes": 0, "source": "deliverable",
						"state": "unavailable", "errorCode": "attachment_denied",
					},
					{
						"attachmentId": "att_large11111111111", "kind": "image", "name": "large.png",
						"mime": "image/png", "bytes": 25 * 1024 * 1024, "source": "deliverable",
						"state": "failed", "errorCode": "attachment_too_large",
					},
				},
			},
		},
		"hasMore": false, "active": false,
	}
	go func() { _ = answerCommand(connector.connection, protocol.MethodSessionTranscript, transcript) }()
	status, body := testRequest(t, http.MethodGet,
		environment.http.URL+"/v1/mobile/sessions/sess-1/messages?deviceId="+connector.deviceID+"&workspaceId=ws-1",
		phone.AccessToken, nil)
	if status != http.StatusOK {
		t.Fatalf("transcript status=%d body=%s", status, body)
	}

	// A declaration the desktop refused keeps its verdict, so the phone can show
	// the reason instead of retrying a file that will never be served.
	var learned protocol.MobileTranscriptResponse
	decodeTestJSON(t, body, &learned)
	if len(learned.Messages) != 1 || len(learned.Messages[0].Attachments) != 3 {
		t.Fatalf("expected three learned attachments: %+v", learned.Messages)
	}
	denied := learned.Messages[0].Attachments[1]
	if denied.State != protocol.AttachmentStateUnavailable || denied.ErrorCode != protocol.AttachmentErrorDenied {
		t.Fatalf("denied verdict was not preserved: %+v", denied)
	}
	response, refused := getAttachment(t, environment.http.URL, phone.AccessToken, "att_denied1111111111", "")
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("denied attachment status=%d body=%s", response.StatusCode, refused)
	}
	response, oversizedDeclaration := getAttachment(t, environment.http.URL, phone.AccessToken, "att_large11111111111", "")
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized declaration status=%d body=%s", response.StatusCode, oversizedDeclaration)
	}

	// An id the Server never learned stays a 404 even with a valid grant.
	response, unknown := getAttachment(t, environment.http.URL, phone.AccessToken, "att_zzzzzzzzzzzzzzzz", "")
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown attachment status=%d body=%s", response.StatusCode, unknown)
	}

	// A second desktop cannot fill in another desktop's attachment row.
	other := pairConnector(t, environment.testEnvironment)
	status, body = uploadAttachment(
		t, environment.http.URL, other.deviceToken, attachmentID, "sess-1",
		fileBytes, int64(len(fileBytes)), digestOf(fileBytes),
	)
	if status != http.StatusForbidden {
		t.Fatalf("foreign device upload status=%d body=%s", status, body)
	}

	// A digest that does not match the body is refused.
	status, body = uploadAttachment(
		t, environment.http.URL, connector.deviceToken, attachmentID, "sess-1",
		fileBytes, int64(len(fileBytes)), digestOf([]byte("other-bytes")),
	)
	if status != http.StatusConflict {
		t.Fatalf("bad digest upload status=%d body=%s", status, body)
	}

	// A body larger than the configured cap is refused before storage.
	oversized := bytes.Repeat([]byte("x"), 64)
	status, body = uploadAttachment(
		t, environment.http.URL, connector.deviceToken, attachmentID, "sess-1",
		oversized, int64(len(oversized)), digestOf(oversized),
	)
	if status != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized upload status=%d body=%s", status, body)
	}

	// A wrong session header is refused.
	status, body = uploadAttachment(
		t, environment.http.URL, connector.deviceToken, attachmentID, "sess-other",
		fileBytes, int64(len(fileBytes)), digestOf(fileBytes),
	)
	if status != http.StatusConflict {
		t.Fatalf("wrong session upload status=%d body=%s", status, body)
	}
}

func TestServerStartRecoversInterruptedAttachmentFetch(t *testing.T) {
	environment := newAttachmentEnvironment(t)
	const attachmentID = "att_interrupted111111"
	now := nowUTC()
	if err := environment.server.store.UpsertSessionAttachments(context.Background(), []store.SessionAttachmentRecord{{
		ID: attachmentID, DeviceID: "dev-1", SessionID: "sess-1", WorkspaceID: "ws-1",
		Source: protocol.AttachmentSourceDeliverable, Kind: "image", DisplayName: "diagram.png",
		Mime: "image/png", Bytes: 128, State: protocol.AttachmentStateKnown, ExpiresAt: now.Add(time.Hour),
	}}, now); err != nil {
		t.Fatalf("learn attachment: %v", err)
	}
	won, err := environment.server.store.BeginAttachmentFetch(context.Background(), attachmentID, now)
	if err != nil || !won {
		t.Fatalf("begin fetch won=%v err=%v", won, err)
	}
	environment.server.Close()

	restarted, err := New(context.Background(), Config{
		BootstrapToken: testBootstrapToken,
		DatabaseURL:    environment.databaseURL,
		AttachmentDir:  t.TempDir(),
	})
	if err != nil {
		t.Fatalf("restart Server: %v", err)
	}
	t.Cleanup(restarted.Close)
	row, err := restarted.store.SessionAttachment(context.Background(), attachmentID)
	if err != nil {
		t.Fatalf("load recovered attachment: %v", err)
	}
	if row.State != protocol.AttachmentStateKnown || row.ErrorCode != "" {
		t.Fatalf("interrupted fetch was not released: %+v", row)
	}
}
