package server

import (
	"errors"
	"net/http"
	"runtime"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

// adminInteractionDetail is the complete read-only approval context. It never
// contains a decision, answers, session content or workspace filesystem paths.
type adminInteractionDetail struct {
	InteractionID string                         `json:"interactionId"`
	Kind          string                         `json:"kind"`
	Title         string                         `json:"title"`
	ToolName      string                         `json:"toolName"`
	Reason        string                         `json:"reason"`
	CallID        string                         `json:"callId"`
	Questions     []protocol.InteractionQuestion `json:"questions"`
	DeviceID      string                         `json:"deviceId"`
	DeviceName    string                         `json:"deviceName"`
	SessionID     string                         `json:"sessionId"`
	WorkspaceID   string                         `json:"workspaceId"`
	WorkspaceName string                         `json:"workspaceName"`
	CreatedAt     time.Time                      `json:"createdAt"`
	ExpiresAt     time.Time                      `json:"expiresAt"`
}

type adminInteractionListResponse struct {
	Interactions []adminInteractionDetail `json:"interactions"`
}

func (s *Server) handleAdminInteractions(w http.ResponseWriter, r *http.Request) {
	devices, err := s.store.Devices(r.Context())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load devices", true))
		return
	}
	deviceNames := make(map[string]string, len(devices))
	for _, device := range devices {
		deviceNames[device.Device.DeviceID] = device.Device.DeviceName
	}
	items := s.interactions.list(nowUTC())
	interactions := make([]adminInteractionDetail, 0, len(items))
	for _, item := range items {
		questions := item.Questions
		if questions == nil {
			questions = []protocol.InteractionQuestion{}
		}
		interactions = append(interactions, adminInteractionDetail{
			InteractionID: item.InteractionID,
			Kind:          item.Kind,
			Title:         item.Title,
			ToolName:      item.ToolName,
			Reason:        item.Reason,
			CallID:        item.CallID,
			Questions:     questions,
			DeviceID:      item.DeviceID,
			DeviceName:    deviceNames[item.DeviceID],
			SessionID:     item.SessionID,
			WorkspaceID:   item.WorkspaceID,
			WorkspaceName: item.WorkspaceName,
			CreatedAt:     item.CreatedAt,
			ExpiresAt:     item.ExpiresAt,
		})
	}
	writeJSON(w, http.StatusOK, adminInteractionListResponse{Interactions: interactions})
}

func (s *Server) handleAdminApprovalPolicy(w http.ResponseWriter, r *http.Request) {
	policy, err := s.store.ApprovalPolicy(r.Context())
	if err != nil {
		writeApprovalPolicyStoreError(w, err, "load")
		return
	}
	writeJSON(w, http.StatusOK, policy)
}

type updateApprovalPolicyRequest struct {
	RemoteEnabled *bool `json:"remoteEnabled"`
	TTLSeconds    *int  `json:"ttlSeconds"`
	Revision      int64 `json:"revision"`
}

func (s *Server) handleAdminUpdateApprovalPolicy(w http.ResponseWriter, r *http.Request) {
	var request updateApprovalPolicyRequest
	if commandError := decodeJSON(w, r, s.config.MaxPayloadBytes, &request); commandError != nil {
		writeAPIError(w, *commandError)
		return
	}
	if request.Revision < 1 {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "a positive revision is required", false))
		return
	}
	if request.TTLSeconds != nil && (*request.TTLSeconds < 30 || *request.TTLSeconds > 600) {
		writeAPIError(w, protocol.NewError(protocol.CodeInvalidRequest, "ttlSeconds must be between 30 and 600", false))
		return
	}
	updated, err := s.store.UpdateApprovalPolicy(r.Context(), request.Revision, store.ApprovalPolicyUpdate{
		RemoteEnabled: request.RemoteEnabled,
		TTLSeconds:    request.TTLSeconds,
	})
	if err != nil {
		writeApprovalPolicyStoreError(w, err, "update")
		return
	}

	// SetEnabled closes admission before clearing when disabling. SetTTL also
	// narrows existing items, including any admitted immediately before this update.
	s.interactions.SetEnabled(updated.RemoteEnabled)
	if request.TTLSeconds != nil {
		s.interactions.SetTTL(time.Duration(updated.TTLSeconds)*time.Second, nowUTC())
	}
	s.recordAdminAudit(r, "admin.approval_policy.update", "success", "")
	writeJSON(w, http.StatusOK, updated)
}

func writeApprovalPolicyStoreError(w http.ResponseWriter, err error, operation string) {
	switch {
	case errors.Is(err, store.ErrApprovalPolicyNotFound):
		writeAPIError(w, protocol.NewError(protocol.CodeNotFound, "approval policy not found", false))
	case errors.Is(err, store.ErrApprovalPolicyConflict):
		writeAPIError(w, protocol.NewError(protocol.CodeConflict, "approval policy revision conflict", false))
	default:
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not "+operation+" approval policy", true))
	}
}

type adminRuntimeSettings struct {
	ServerURL                   string    `json:"serverUrl"`
	PairingCodeTTLSeconds       int64     `json:"pairingCodeTTLSeconds"`
	MobileAccessTokenTTLSeconds int64     `json:"mobileAccessTokenTTLSeconds"`
	AdminSessionTTLSeconds      int64     `json:"adminSessionTTLSeconds"`
	CommandTimeoutSeconds       int64     `json:"commandTimeoutSeconds"`
	AttachmentsMode             string    `json:"attachmentsMode"`
	MaxAttachmentBytes          int64     `json:"maxAttachmentBytes"`
	AttachmentTTLSeconds        int64     `json:"attachmentTTLSeconds"`
	GoVersion                   string    `json:"goVersion"`
	DatabaseDialect             string    `json:"databaseDialect"`
	DatabaseConnected           bool      `json:"databaseConnected"`
	GeneratedAt                 time.Time `json:"generatedAt"`
}

func (s *Server) handleAdminSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, adminRuntimeSettings{
		ServerURL:                   s.config.ServerURL,
		PairingCodeTTLSeconds:       int64(s.config.PairingCodeTTL / time.Second),
		MobileAccessTokenTTLSeconds: int64(s.config.MobileAccessTokenTTL / time.Second),
		AdminSessionTTLSeconds:      int64(s.config.AdminSessionTTL / time.Second),
		CommandTimeoutSeconds:       int64(s.config.CommandTimeout / time.Second),
		AttachmentsMode:             s.config.AttachmentsMode,
		MaxAttachmentBytes:          s.config.MaxAttachmentBytes,
		AttachmentTTLSeconds:        int64(s.config.AttachmentTTL / time.Second),
		GoVersion:                   runtime.Version(),
		DatabaseDialect:             s.store.DatabaseDialect(),
		DatabaseConnected:           s.store.Ping(r.Context()) == nil,
		GeneratedAt:                 nowUTC(),
	})
}
