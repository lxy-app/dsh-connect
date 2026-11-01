package server

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
)

func randomToken(prefix string) (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", fmt.Errorf("generate random token: %w", err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(data), nil
}

func randomPairingCode() (string, error) {
	data := make([]byte, 15)
	if _, err := rand.Read(data); err != nil {
		return "", fmt.Errorf("generate pairing code: %w", err)
	}
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(data)
	var result strings.Builder
	for index, char := range encoded {
		if index > 0 && index%4 == 0 {
			result.WriteByte('-')
		}
		result.WriteRune(char)
	}
	return result.String(), nil
}

func fingerprint(deviceID, pairingToken string) string {
	sum := sha256.Sum256([]byte(deviceID + "." + pairingToken))
	return "SHA256:" + strings.ToUpper(hex.EncodeToString(sum[:16]))
}

func bearerToken(header string) (string, bool) {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", false
	}
	return parts[1], true
}

func tokensEqual(left, right string) bool {
	leftHash := sha256.Sum256([]byte(left))
	rightHash := sha256.Sum256([]byte(right))
	return subtle.ConstantTimeCompare(leftHash[:], rightHash[:]) == 1
}

func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok || !tokensEqual(token, s.config.BootstrapToken) {
			writeAPIError(w, protocol.NewError(protocol.CodeUnauthorized, "valid bootstrap bearer token required", false))
			return
		}
		next(w, r)
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, limit int64, destination any) *protocol.Error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return errorPtr(protocol.NewError(protocol.CodePayloadTooLarge, "request payload exceeds limit", false))
		}
		return errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "invalid JSON request body", false))
	}
	var extra any
	if err := decoder.Decode(&extra); err == nil {
		return errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "request body must contain one JSON value", false))
	} else if !errors.Is(err, io.EOF) {
		return errorPtr(protocol.NewError(protocol.CodeInvalidRequest, "invalid trailing JSON data", false))
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeAPIError(w http.ResponseWriter, commandError protocol.Error) {
	status := httpStatus(commandError.Code)
	writeJSON(w, status, protocol.ErrorResponse{V: protocol.Version, Error: commandError})
}

func httpStatus(code string) int {
	switch code {
	case protocol.CodeUnauthorized:
		return http.StatusUnauthorized
	case protocol.CodePairingCodeInvalid:
		return http.StatusUnauthorized
	case protocol.CodeForbidden:
		return http.StatusForbidden
	case protocol.CodeInvalidRequest:
		return http.StatusBadRequest
	case protocol.CodeNotFound:
		return http.StatusNotFound
	case protocol.CodePayloadTooLarge:
		return http.StatusRequestEntityTooLarge
	case protocol.CodePairingCodeUsed, protocol.CodePairingCodeExpired, protocol.CodePairingChallengeExpired, protocol.CodePairingAlreadyCompleted, protocol.CodeRequestInFlight, protocol.CodeIdempotencyConflict, protocol.CodeConflict:
		return http.StatusConflict
	case protocol.CodeDeviceOffline:
		return http.StatusServiceUnavailable
	case protocol.CodeCommandTimeout:
		return http.StatusGatewayTimeout
	case protocol.CodeInternalError:
		return http.StatusInternalServerError
	default:
		return http.StatusBadGateway
	}
}

func errorPtr(value protocol.Error) *protocol.Error {
	return &value
}

func sourceIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func validID(value string) bool {
	return value != "" && len(value) <= 128 && !strings.ContainsAny(value, "\x00\r\n")
}

func validText(value string, max int) bool {
	return value != "" && len(value) <= max && !strings.ContainsAny(value, "\x00\r\n")
}

func nowUTC() time.Time {
	return time.Now().UTC().Truncate(time.Millisecond)
}
