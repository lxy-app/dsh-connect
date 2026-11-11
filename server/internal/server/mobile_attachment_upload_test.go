package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

// uploadPhoneAttachment posts bytes the way the App does: raw body, display
// name in a header, and identity in the query string.
func uploadPhoneAttachment(
	t *testing.T,
	baseURL, phoneToken, sessionID, deviceID, workspaceID, name string,
	body []byte,
) (*http.Response, []byte) {
	t.Helper()
	query := url.Values{"deviceId": {deviceID}, "workspaceId": {workspaceID}}
	endpoint := baseURL + "/v1/mobile/sessions/" + sessionID + "/attachments?" + query.Encode()
	request, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build upload request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+phoneToken)
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set("X-DSH-Attachment-Name-Encoding", "url")
	request.Header.Set("X-DSH-Attachment-Name", url.QueryEscape(name))
	request.ContentLength = int64(len(body))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("upload phone attachment: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read upload response: %v", err)
	}
	return response, payload
}

// TestMobilePromptCarriesUploadedAttachments walks the whole uplink: the phone
// stages a PNG and a text file, references both in one prompt, and the prompt
// content the Connector receives orders text first then the attachments.
func TestMobilePromptCarriesUploadedAttachments(t *testing.T) {
	environment := newAttachmentEnvironment(t, func(config *Config) {
		config.AttachmentsMode = attachmentsModeReadWrite
	})
	ownerToken, ownerID := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	phone := pairMobile(t, environment, issueMobilePairingCode(t, environment, ownerToken, "").Code, "Uplink iPhone")
	allowUserAccess(t, environment, phone.User.ID, connector.deviceID, []string{"ws-1"}, []string{"read", "prompt"})

	// The desktop must approve the requested scopes before a prompt can be sent.
	requestGrant := func() protocol.MobileAccessGrant {
		t.Helper()
		status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
			"deviceId": connector.deviceID, "workspaces": []string{"ws-1"}, "scopes": []string{"read", "prompt"},
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
			"scopes":         []string{"read", "prompt"},
		})
		var grant protocol.MobileAccessGrant
		if err := json.Unmarshal(decided, &grant); err != nil {
			t.Fatalf("decode grant: %v", err)
		}
		return grant
	}
	_ = requestGrant()
	_ = ownerID

	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("p", 40))
	text := []byte("export const value = 1;\n")

	response, payload := uploadPhoneAttachment(t, environment.http.URL, phone.AccessToken, "sess-1", connector.deviceID, "ws-1", "截图 01.png", png)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("png upload status=%d body=%s", response.StatusCode, payload)
	}
	var pngResult protocol.MobileAttachmentUploadResult
	decodeTestJSON(t, payload, &pngResult)
	if pngResult.Kind != "image" || pngResult.Mime != "image/png" || pngResult.Bytes != int64(len(png)) || pngResult.Name != "截图 01.png" {
		t.Fatalf("unexpected png result: %+v", pngResult)
	}

	response, payload = uploadPhoneAttachment(t, environment.http.URL, phone.AccessToken, "sess-1", connector.deviceID, "ws-1", "demo.ts", text)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("text upload status=%d body=%s", response.StatusCode, payload)
	}
	var textResult protocol.MobileAttachmentUploadResult
	decodeTestJSON(t, payload, &textResult)
	if textResult.Kind != "file" || textResult.Bytes != int64(len(text)) {
		t.Fatalf("unexpected text result: %+v", textResult)
	}

	// The prompt reaches the Connector with text first and both attachment refs.
	commandErr := make(chan error, 1)
	received := make(chan map[string]any, 1)
	go func() {
		err := answerCommandCapturing(t, connector.connection, protocol.MethodSessionPrompt, received)
		commandErr <- err
	}()
	status, payload := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions/sess-1/prompt", phone.AccessToken, map[string]any{
		"requestId": "uplink-prompt-1", "deviceId": connector.deviceID, "workspaceId": "ws-1", "mode": "queue",
		"text": "看下这两张附件",
		"attachments": []map[string]any{
			{"attachmentId": pngResult.AttachmentID},
			{"attachmentId": textResult.AttachmentID},
		},
	})
	if err := <-commandErr; err != nil {
		t.Fatalf("connector prompt round trip: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("prompt status=%d body=%s", status, payload)
	}
	params := <-received
	rawParts, ok := params["content"].([]any)
	if !ok || len(rawParts) != 3 {
		t.Fatalf("unexpected prompt content: %+v", params["content"])
	}
	first := rawParts[0].(map[string]any)
	if first["type"] != "text" || first["text"] != "看下这两张附件" {
		t.Fatalf("text part not first: %+v", first)
	}
	image := rawParts[1].(map[string]any)
	if image["type"] != "image" || image["attachmentId"] != pngResult.AttachmentID {
		t.Fatalf("unexpected image part: %+v", image)
	}
	file := rawParts[2].(map[string]any)
	if file["type"] != "file" || file["attachmentId"] != textResult.AttachmentID {
		t.Fatalf("unexpected file part: %+v", file)
	}
}

// TestMobileAttachmentUploadRefusals covers the gates that keep a phone from
// staging bytes for a session it cannot prompt, or naming another phone's bytes.
func TestMobileAttachmentUploadRefusals(t *testing.T) {
	environment := newAttachmentEnvironment(t, func(config *Config) {
		config.AttachmentsMode = attachmentsModeReadWrite
		config.MaxAttachmentBytes = 64
	})
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	phone := pairMobile(t, environment, issueMobilePairingCode(t, environment, ownerToken, "").Code, "Refusal iPhone")
	grantMobileRead(t, environment, connector, phone)

	// A read-only grant cannot stage uploads, because it cannot prompt either.
	response, body := uploadPhoneAttachment(t, environment.http.URL, phone.AccessToken, "sess-1", connector.deviceID, "ws-1", "a.png", []byte("x"))
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("read-only upload status=%d body=%s", response.StatusCode, body)
	}

	// Another workspace is outside the grant.
	response, body = uploadPhoneAttachment(t, environment.http.URL, phone.AccessToken, "sess-2", connector.deviceID, "ws-2", "a.png", []byte("x"))
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign workspace upload status=%d body=%s", response.StatusCode, body)
	}

	// Path separators are refused, so a name can never look like a desktop path.
	response, body = uploadPhoneAttachment(t, environment.http.URL, phone.AccessToken, "sess-1", connector.deviceID, "ws-1", "../../etc/passwd", []byte("x"))
	if response.StatusCode != http.StatusForbidden && response.StatusCode != http.StatusBadRequest {
		t.Fatalf("traversal name status=%d body=%s", response.StatusCode, body)
	}

	// The payload cap is enforced before any bytes are stored.
	response, body = uploadPhoneAttachment(t, environment.http.URL, phone.AccessToken, "sess-1", connector.deviceID, "ws-1", "big.bin", bytes.Repeat([]byte("z"), 65))
	if response.StatusCode != http.StatusRequestEntityTooLarge && response.StatusCode != http.StatusForbidden {
		t.Fatalf("oversized upload status=%d body=%s", response.StatusCode, body)
	}
}

// TestMobilePromptAttachmentOwnership keeps one phone from referencing bytes
// staged by another phone or a desktop-declared delivery.
func TestMobilePromptAttachmentOwnership(t *testing.T) {
	environment := newAttachmentEnvironment(t, func(config *Config) {
		config.AttachmentsMode = attachmentsModeReadWrite
	})
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	mobileCode := issueMobilePairingCode(t, environment, ownerToken, "")
	phone := pairMobile(t, environment, mobileCode.Code, "Owner Phone")
	grantMobileRead(t, environment, connector, phone)

	// Seeding a row through the store directly mirrors a staged upload owned by
	// another phone; the prompt must refuse it.
	now := nowUTC()
	if err := environment.server.store.CreateUploadedAttachment(t.Context(), store.SessionAttachmentRecord{
		ID: "atu_foreign_owner_bytes", DeviceID: connector.deviceID, SessionID: "sess-1", WorkspaceID: "ws-1",
		Source: protocol.AttachmentSourceUpload, Kind: "image", DisplayName: "x.png", Mime: "image/png",
		Bytes: 3, SHA256: "abc", State: protocol.AttachmentStateReady, ExpiresAt: now.Add(time.Hour),
	}, now); err != nil {
		t.Fatalf("seed attachment: %v", err)
	}

	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions/sess-1/prompt", phone.AccessToken, map[string]any{
		"requestId": "ownership-1", "deviceId": connector.deviceID, "workspaceId": "ws-1", "mode": "queue",
		"text":        "hi",
		"attachments": []map[string]any{{"attachmentId": "atu_foreign_owner_bytes"}},
	})
	if status != http.StatusForbidden && status != http.StatusNotFound {
		t.Fatalf("foreign attachment prompt status=%d body=%s", status, body)
	}

	// A prompt with neither text nor attachments is refused outright.
	status, body = testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/sessions/sess-1/prompt", phone.AccessToken, map[string]any{
		"requestId": "ownership-2", "deviceId": connector.deviceID, "workspaceId": "ws-1", "mode": "queue",
	})
	if status != http.StatusBadRequest {
		t.Fatalf("empty prompt status=%d body=%s", status, body)
	}
}

// answerCommandCapturing answers one prompt command and publishes its params.
func answerCommandCapturing(t *testing.T, connection *websocket.Conn, method string, params chan<- map[string]any) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	messageType, data, err := connection.Read(ctx)
	if err != nil {
		return err
	}
	if messageType != websocket.MessageText {
		return errInvalidFrame
	}
	var command connectorCommandFrame
	if err := json.Unmarshal(data, &command); err != nil {
		return err
	}
	if command.Type != protocol.TypeCommand || command.Method != method {
		return errUnexpectedCommand
	}
	var decoded map[string]any
	if err := json.Unmarshal(command.Params, &decoded); err != nil {
		return err
	}
	params <- decoded
	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1", "requestId": command.RequestID, "status": "accepted"})
	if err != nil {
		return err
	}
	response, err := json.Marshal(protocol.Result{
		V: protocol.Version, Type: protocol.TypeResult, RequestID: command.RequestID, Result: payload,
	})
	if err != nil {
		return err
	}
	writeCtx, writeCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer writeCancel()
	return connection.Write(writeCtx, websocket.MessageText, response)
}

// TestConnectorUploadDownloadServesOwnedBytes keeps staged phone uploads
// readable by the owning desktop only, and only once they are ready.
func TestConnectorUploadDownloadServesOwnedBytes(t *testing.T) {
	environment := newAttachmentEnvironment(t, func(config *Config) {
		config.AttachmentsMode = attachmentsModeReadWrite
	})
	ownerToken, _ := environment.login(t, testOwnerEmail, testOwnerPassword)
	connector := pairConnector(t, environment.testEnvironment)
	other := pairConnector(t, environment.testEnvironment)
	phone := pairMobile(t, environment, issueMobilePairingCode(t, environment, ownerToken, "").Code, "Download iPhone")
	allowUserAccess(t, environment, phone.User.ID, connector.deviceID, []string{"ws-1"}, []string{"read", "prompt"})
	status, body := testRequest(t, http.MethodPost, environment.http.URL+"/v1/mobile/access/requests", phone.AccessToken, map[string]any{
		"deviceId": connector.deviceID, "workspaces": []string{"ws-1"}, "scopes": []string{"read", "prompt"},
	})
	if status != http.StatusCreated {
		t.Fatalf("access request status=%d body=%s", status, body)
	}
	connectorRequest(t, connector.connection, protocol.ConnectorMethodMobileAccessDecide, map[string]any{
		"mobileDeviceId": phone.MobileDeviceID, "action": "allow",
		"workspaces": []string{"ws-1"}, "scopes": []string{"read", "prompt"},
	})

	payload := []byte("\x89PNG\r\n\x1a\n staged-png")
	response, uploaded := uploadPhoneAttachment(t, environment.http.URL, phone.AccessToken, "sess-1", connector.deviceID, "ws-1", "staged.png", payload)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("upload status=%d body=%s", response.StatusCode, uploaded)
	}
	var result protocol.MobileAttachmentUploadResult
	decodeTestJSON(t, uploaded, &result)

	endpoint := environment.http.URL + "/v1/connector/uploads/" + result.AttachmentID
	if statusCode, downloaded := connectorDownload(t, endpoint, connector.deviceToken); statusCode != http.StatusOK || string(downloaded) != string(payload) {
		t.Fatalf("owner download status=%d body=%q", statusCode, downloaded)
	}
	if statusCode, _ := connectorDownload(t, endpoint, other.deviceToken); statusCode != http.StatusForbidden {
		t.Fatalf("foreign device download status=%d, want 403", statusCode)
	}
	// A desktop-declared attachment is never served through this uplink route.
	if statusCode, _ := connectorDownload(t, environment.http.URL+"/v1/connector/uploads/att_b7Qk2m9xT4pL0rVc8sN1", connector.deviceToken); statusCode != http.StatusNotFound {
		t.Fatalf("unknown upload download status=%d, want 404", statusCode)
	}
}

func connectorDownload(t *testing.T, endpoint, deviceToken string) (int, []byte) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+deviceToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("download staged upload: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read staged upload: %v", err)
	}
	return response.StatusCode, payload
}
