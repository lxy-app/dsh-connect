package preview

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrConversion deliberately contains no response body, display name or path.
// The main Server exposes every Worker failure as preview_failed.
var ErrConversion = errors.New("preview conversion failed")

// Client calls only the configured internal preview Worker.
type Client struct {
	endpoint   string
	token      string
	maxBytes   int64
	httpClient *http.Client
}

func NewClient(workerURL, token string, maxBytes int64, timeout time.Duration) (*Client, error) {
	parsed, err := url.Parse(workerURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("preview Worker URL must be an absolute HTTP(S) URL without credentials, query or fragment")
	}
	if token == "" {
		return nil, errors.New("preview Worker token is required")
	}
	if maxBytes < 1 || timeout <= 0 {
		return nil, errors.New("invalid preview size or timeout configuration")
	}
	return &Client{
		endpoint:   strings.TrimRight(parsed.String(), "/") + "/convert",
		token:      token,
		maxBytes:   maxBytes,
		httpClient: &http.Client{Timeout: timeout},
	}, nil
}

// Convert streams authorized attachment bytes to the Worker and bounds its
// response before accepting the derived PDF.
func (c *Client) Convert(ctx context.Context, extension string, source io.Reader) ([]byte, error) {
	if !SupportedOfficeExtension(extension) {
		return nil, ErrConversion
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, source)
	if err != nil {
		return nil, ErrConversion
	}
	request.Header.Set("Authorization", "Bearer "+c.token)
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set(ExtensionHeader, extension)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, ErrConversion
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil, ErrConversion
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, c.maxBytes+1))
	if err != nil || !ValidPDF(data, c.maxBytes) {
		return nil, ErrConversion
	}
	return data, nil
}

// ValidPDF checks both the byte cap and the signature required from a Worker.
func ValidPDF(data []byte, maxBytes int64) bool {
	return int64(len(data)) > 0 && int64(len(data)) <= maxBytes && bytes.HasPrefix(data, []byte("%PDF-"))
}

// conversionError is wrapped only inside internal Worker diagnostics; HTTP
// responses intentionally remain generic.
func conversionError(err error) error {
	if err == nil {
		return ErrConversion
	}
	return fmt.Errorf("%w: %v", ErrConversion, err)
}
