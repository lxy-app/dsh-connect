// Package protocol defines the stable, versioned wire DTOs shared by the
// debug API and Connector relay. DSH-specific types belong in Connector.
package protocol

import (
	"encoding/json"
	"time"
)

const Version = 1

const (
	TypePairStart     = "pair.start"
	TypePairChallenge = "pair.challenge"
	TypePairAuthorize = "pair.authorize"
	TypePairComplete  = "pair.complete"
	TypeCommand       = "command"
	TypeResult        = "result"
	TypeError         = "error"
	TypeEvent         = "event"
	TypeFollowResult  = "follow.result"
	// TypeRequest is sent by an authenticated Connector for desktop-scoped
	// control-plane queries such as mobile access approval. The Server answers
	// with TypeResult or TypeError using the same requestId.
	TypeRequest = "request"
)

const (
	MethodSessionList       = "session.list"
	MethodSessionCreate     = "session.create"
	MethodSessionPage       = "session.page"
	MethodSessionTranscript = "session.transcript"
	MethodSessionPrompt     = "session.prompt"
	MethodSessionFollow     = "session.follow"
	MethodSessionUnfollow   = "session.unfollow"
	MethodSessionCancel     = "session.cancel"
	// MethodSessionAttachmentFetch asks the Connector to re-read one declared
	// file and upload its bytes to the Server attachment store. Bytes never
	// travel back through this command.
	MethodSessionAttachmentFetch = "session.attachment.fetch"
)

// Attachment states are shared by the Connector, the Server store and the
// mobile wire contract. Only the Server advances a row past "known".
const (
	AttachmentStateKnown       = "known"
	AttachmentStateFetching    = "fetching"
	AttachmentStateReady       = "ready"
	AttachmentStateFailed      = "failed"
	AttachmentStateUnavailable = "unavailable"
)

// Attachment sources identify which DSH session fact declared the file.
const (
	AttachmentSourceDeliverable = "deliverable"
	AttachmentSourceMessage     = "message"
	AttachmentSourceTool        = "tool"
)

// Attachment error codes stay stable across the Connector and the App.
const (
	AttachmentErrorUnknown     = "attachment_unknown"
	AttachmentErrorUnavailable = "attachment_unavailable"
	AttachmentErrorChanged     = "attachment_changed"
	AttachmentErrorTooLarge    = "attachment_too_large"
	AttachmentErrorDenied      = "attachment_denied"
	AttachmentErrorFailed      = "attachment_failed"
	AttachmentErrorNotReady    = "attachment_not_ready"
	AttachmentErrorExpired     = "attachment_expired"
)

// AttachmentSealedSource is the event kind broadcast to a phone once bytes are
// cached on the Server.
const EventKindAttachmentReady = "attachment.ready"

const (
	ConnectorMethodMobileAccessList    = "mobile.access.list"
	ConnectorMethodMobileAccessDecide  = "mobile.access.decide"
	ConnectorMethodPairUpdateGrants    = "pair.updateGrants"
	ConnectorMethodInteractionAudience = "interaction.audience"
)

type Header struct {
	V         int    `json:"v"`
	Type      string `json:"type"`
	RequestID string `json:"requestId,omitempty"`
}

type PairStart struct {
	V                int    `json:"v"`
	Type             string `json:"type"`
	RequestID        string `json:"requestId"`
	PairingCode      string `json:"pairingCode"`
	DeviceName       string `json:"deviceName"`
	ConnectorVersion string `json:"connectorVersion"`
}

type PairChallenge struct {
	V            int       `json:"v"`
	Type         string    `json:"type"`
	RequestID    string    `json:"requestId"`
	DeviceID     string    `json:"deviceId"`
	Fingerprint  string    `json:"fingerprint"`
	PairingToken string    `json:"pairingToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

type Workspace struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

type PairAuthorize struct {
	V            int         `json:"v"`
	Type         string      `json:"type"`
	RequestID    string      `json:"requestId"`
	PairingToken string      `json:"pairingToken"`
	Workspaces   []Workspace `json:"workspaces"`
	Scopes       []string    `json:"scopes"`
}

type PairComplete struct {
	V           int    `json:"v"`
	Type        string `json:"type"`
	RequestID   string `json:"requestId"`
	DeviceID    string `json:"deviceId"`
	DeviceToken string `json:"deviceToken"`
	Fingerprint string `json:"fingerprint"`
}

type Command struct {
	V         int             `json:"v"`
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	Method    string          `json:"method"`
	Params    json.RawMessage `json:"params"`
	TimeoutMS int             `json:"timeoutMs"`
}

type Result struct {
	V         int             `json:"v"`
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	Result    json.RawMessage `json:"result"`
}

type Error struct {
	Code      string          `json:"code"`
	Message   string          `json:"message"`
	Retryable bool            `json:"retryable"`
	Details   json.RawMessage `json:"details,omitempty"`
}

type ErrorEnvelope struct {
	V         int    `json:"v"`
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	Error     Error  `json:"error"`
}

type ErrorResponse struct {
	V     int   `json:"v"`
	Error Error `json:"error"`
}

type Event struct {
	V          int             `json:"v"`
	Type       string          `json:"type"`
	EventID    string          `json:"eventId"`
	DeviceID   string          `json:"deviceId"`
	SessionID  string          `json:"sessionId"`
	Seq        uint64          `json:"seq,omitempty"`
	Kind       string          `json:"kind"`
	OccurredAt time.Time       `json:"occurredAt"`
	Data       json.RawMessage `json:"data"`
}

type FollowResult struct {
	V         int             `json:"v"`
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	Result    json.RawMessage `json:"result"`
}

type Device struct {
	DeviceID         string      `json:"deviceId"`
	DeviceName       string      `json:"deviceName"`
	Fingerprint      string      `json:"fingerprint"`
	ConnectorVersion string      `json:"connectorVersion"`
	Status           string      `json:"status"`
	Workspaces       []Workspace `json:"workspaces"`
	Scopes           []string    `json:"scopes"`
	CreatedAt        time.Time   `json:"createdAt"`
	UpdatedAt        time.Time   `json:"updatedAt"`
	LastSeenAt       *time.Time  `json:"lastSeenAt,omitempty"`
}

type ContentPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type Session struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	WorkspaceID string    `json:"workspaceId"`
	Status      string    `json:"status"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type SessionListResult struct {
	Sessions []json.RawMessage `json:"sessions"`
}

type SessionCreateResult struct {
	SessionID   string `json:"sessionId"`
	WorkspaceID string `json:"workspaceId"`
	AgentPreset string `json:"agentPreset,omitempty"`
}

type SessionPageResult struct {
	Items      []json.RawMessage `json:"items"`
	NextCursor string            `json:"nextCursor,omitempty"`
}

type SessionPromptResult struct {
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId"`
	Status    string `json:"status"`
}

type DesktopCodeResponse struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
	ServerURL string    `json:"serverUrl"`
}

// MobileUser is the identity projection returned to a paired phone. It contains
// no password or administrative session material.
type MobileUser struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
}

// MobileDevice is the public projection of a paired phone.
type MobileDevice struct {
	MobileDeviceID string     `json:"mobileDeviceId"`
	UserID         string     `json:"userId"`
	DeviceName     string     `json:"deviceName"`
	Platform       string     `json:"platform"`
	AppVersion     string     `json:"appVersion"`
	Status         string     `json:"status"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	LastSeenAt     *time.Time `json:"lastSeenAt,omitempty"`
	RevokedAt      *time.Time `json:"revokedAt,omitempty"`
}

type MobilePairingCodeRequest struct {
	UserID string `json:"userId,omitempty"`
}

type MobilePairingCodeResponse struct {
	Code       string    `json:"code"`
	ExpiresAt  time.Time `json:"expiresAt"`
	ServerURL  string    `json:"serverUrl"`
	PairingURL string    `json:"pairingUrl"`
	UserID     string    `json:"userId"`
}

type MobilePairRequest struct {
	Code       string `json:"code"`
	DeviceName string `json:"deviceName"`
	Platform   string `json:"platform"`
	AppVersion string `json:"appVersion"`
}

// MobileSessionResponse is returned by both pairing and refresh. Plaintext
// access and refresh tokens are only present in this response and are never
// persisted.
type MobileSessionResponse struct {
	MobileDeviceID        string     `json:"mobileDeviceId"`
	User                  MobileUser `json:"user"`
	AccessToken           string     `json:"accessToken"`
	AccessTokenExpiresAt  time.Time  `json:"accessTokenExpiresAt"`
	RefreshToken          string     `json:"refreshToken"`
	RefreshTokenExpiresAt time.Time  `json:"refreshTokenExpiresAt"`
}

type MobileRefreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type MobileMeResponse struct {
	MobileDevice MobileDevice `json:"mobileDevice"`
	User         MobileUser   `json:"user"`
}

type MobileDeviceListResponse struct {
	Devices []MobileDevice `json:"devices"`
}

type DeviceListResponse struct {
	Devices []Device `json:"devices"`
}

// MobileWorkspaceSummary is the minimum a phone needs to identify a workspace.
// The desktop filesystem path stays on the desktop.
type MobileWorkspaceSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// InteractionAudienceResponse tells the Connector whether a granted phone is
// actively polling for interactions, so it can hand the prompt to that phone
// first instead of racing two UIs.
type InteractionAudienceResponse struct {
	Watching bool `json:"watching"`
}

// ConnectorUpdateGrants replaces this desktop's own authorized workspaces and
// scopes. Only the authenticated Connector for that device may submit it.
type ConnectorUpdateGrants struct {
	Workspaces []Workspace `json:"workspaces"`
	Scopes     []string    `json:"scopes"`
}

// MobileAccessGrant is the desktop-approved access scope for one phone.
type MobileAccessGrant struct {
	GrantID          string                   `json:"grantId"`
	MobileDeviceID   string                   `json:"mobileDeviceId,omitempty"`
	MobileDeviceName string                   `json:"mobileDeviceName,omitempty"`
	MobileUserName   string                   `json:"mobileUserName,omitempty"`
	MobilePlatform   string                   `json:"mobilePlatform,omitempty"`
	DeviceID         string                   `json:"deviceId"`
	DeviceName       string                   `json:"deviceName,omitempty"`
	Workspaces       []MobileWorkspaceSummary `json:"workspaces"`
	Scopes           []string                 `json:"scopes"`
	Status           string                   `json:"status"`
	CreatedAt        time.Time                `json:"createdAt"`
	UpdatedAt        time.Time                `json:"updatedAt"`
	DecidedAt        *time.Time               `json:"decidedAt,omitempty"`
}

// MobileDesktopAccess is one desktop as seen from a paired phone. Available
// workspaces come from the desktop authorization; Grant is null until the phone
// asks for access.
type MobileDesktopAccess struct {
	DeviceID            string                   `json:"deviceId"`
	DeviceName          string                   `json:"deviceName"`
	ConnectorVersion    string                   `json:"connectorVersion"`
	Online              bool                     `json:"online"`
	AvailableWorkspaces []MobileWorkspaceSummary `json:"availableWorkspaces"`
	AvailableScopes     []string                 `json:"availableScopes"`
	Grant               *MobileAccessGrant       `json:"grant,omitempty"`
}

type MobileAccessOverviewResponse struct {
	Desktops []MobileDesktopAccess `json:"desktops"`
}

// MobileAccessRequest asks the desktop user to approve a subset of the
// desktop's already authorized workspaces and scopes.
type MobileAccessRequest struct {
	DeviceID   string   `json:"deviceId"`
	Workspaces []string `json:"workspaces"`
	Scopes     []string `json:"scopes"`
}

// ConnectorMobileAccessDecision is submitted by the desktop Connector. It never
// travels over the mobile REST surface.
type ConnectorMobileAccessDecision struct {
	MobileDeviceID string   `json:"mobileDeviceId"`
	Action         string   `json:"action"`
	Workspaces     []string `json:"workspaces,omitempty"`
	Scopes         []string `json:"scopes,omitempty"`
}

type ConnectorMobileAccessListResponse struct {
	Grants              []MobileAccessGrant      `json:"grants"`
	AvailableWorkspaces []MobileWorkspaceSummary `json:"availableWorkspaces"`
	AvailableScopes     []string                 `json:"availableScopes"`
}

type MobileWorkspaceView struct {
	GrantID    string                 `json:"grantId"`
	DeviceID   string                 `json:"deviceId"`
	DeviceName string                 `json:"deviceName"`
	Workspace  MobileWorkspaceSummary `json:"workspace"`
	Scopes     []string               `json:"scopes"`
	Online     bool                   `json:"online"`
}

type MobileAccessWarning struct {
	DeviceID   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
	Code       string `json:"code"`
	Message    string `json:"message"`
}

type MobileWorkspaceListResponse struct {
	Workspaces []MobileWorkspaceView `json:"workspaces"`
}

type MobileSessionView struct {
	SessionID     string    `json:"sessionId"`
	Title         string    `json:"title"`
	WorkspaceID   string    `json:"workspaceId"`
	WorkspaceName string    `json:"workspaceName"`
	DeviceID      string    `json:"deviceId"`
	DeviceName    string    `json:"deviceName"`
	Status        string    `json:"status"`
	Scopes        []string  `json:"scopes"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type MobileSessionListResponse struct {
	Sessions []MobileSessionView   `json:"sessions"`
	Warnings []MobileAccessWarning `json:"warnings"`
}

// MobileAttachment is the display-safe projection of one file a Session
// declared for delivery. It never carries a filesystem path: the phone only
// ever sees the opaque attachmentId, and bytes are fetched over HTTPS.
type MobileAttachment struct {
	AttachmentID string `json:"attachmentId"`
	Kind         string `json:"kind"` // image | file
	Name         string `json:"name"`
	Mime         string `json:"mime"`
	Bytes        int64  `json:"bytes"`
	Width        int    `json:"width,omitempty"`
	Height       int    `json:"height,omitempty"`
	Source       string `json:"source"` // deliverable | message | tool
	Description  string `json:"description,omitempty"`
	State        string `json:"state"`
	ErrorCode    string `json:"errorCode,omitempty"`
	// SHA256 is the digest of the stored bytes once state is "ready". The App
	// uses it to bust image caches after a failed or stale fetch.
	SHA256 string `json:"sha256,omitempty"`
	// Preview is optional inline text for small text files. The Server passes
	// it through and never persists it.
	Preview string `json:"preview,omitempty"`
}

type MobileMessage struct {
	ID          string             `json:"id"`
	Seq         uint64             `json:"seq"`
	Role        string             `json:"role"`
	Text        string             `json:"text"`
	ToolName    string             `json:"toolName,omitempty"`
	ToolCallID  string             `json:"toolCallId,omitempty"`
	IsError     bool               `json:"isError,omitempty"`
	Attachments []MobileAttachment `json:"attachments,omitempty"`
	// Delivery marks a synthesized message that only carries a turn's
	// delivered files, so the App can render it as a delivery card.
	Delivery   bool      `json:"delivery,omitempty"`
	OccurredAt time.Time `json:"occurredAt"`
}

type MobileTranscriptResponse struct {
	SessionID   string          `json:"sessionId"`
	DeviceID    string          `json:"deviceId"`
	WorkspaceID string          `json:"workspaceId"`
	Messages    []MobileMessage `json:"messages"`
	HasMore     bool            `json:"hasMore"`
	NextCursor  string          `json:"nextCursor,omitempty"`
	Active      bool            `json:"active"`
	TurnEndSeq  uint64          `json:"turnEndSeq,omitempty"`
	Truncated   bool            `json:"truncated,omitempty"`
}

type MobileSessionCreateRequest struct {
	RequestID   string `json:"requestId"`
	DeviceID    string `json:"deviceId"`
	WorkspaceID string `json:"workspaceId"`
	TimeoutMS   int    `json:"timeoutMs,omitempty"`
}

type MobilePromptRequest struct {
	RequestID   string `json:"requestId"`
	DeviceID    string `json:"deviceId"`
	WorkspaceID string `json:"workspaceId"`
	Mode        string `json:"mode"`
	Text        string `json:"text"`
	TimeoutMS   int    `json:"timeoutMs,omitempty"`
}

type MobileCancelRequest struct {
	RequestID   string `json:"requestId"`
	DeviceID    string `json:"deviceId"`
	WorkspaceID string `json:"workspaceId"`
	TimeoutMS   int    `json:"timeoutMs,omitempty"`
}

// ConnectorRequest is a desktop-scoped control-plane request sent over the
// Connector's authenticated outbound WSS.
type ConnectorRequest struct {
	V         int             `json:"v"`
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	Method    string          `json:"method"`
	Params    json.RawMessage `json:"params,omitempty"`
}

type SessionCreateRequest struct {
	RequestID   string `json:"requestId"`
	DeviceID    string `json:"deviceId"`
	WorkspaceID string `json:"workspaceId"`
	TimeoutMS   int    `json:"timeoutMs,omitempty"`
}

type SessionPromptRequest struct {
	RequestID      string        `json:"requestId"`
	DeviceID       string        `json:"deviceId"`
	Mode           string        `json:"mode"`
	Content        []ContentPart `json:"content"`
	ClientTimeZone string        `json:"clientTimeZone,omitempty"`
	TimeoutMS      int           `json:"timeoutMs,omitempty"`
}

type SessionCancelRequest struct {
	RequestID string `json:"requestId"`
	DeviceID  string `json:"deviceId"`
	TimeoutMS int    `json:"timeoutMs,omitempty"`
}

type SessionFollowParams struct {
	SessionID string `json:"sessionId"`
	FollowID  string `json:"followId"`
	Cursor    string `json:"cursor,omitempty"`
	Stream    bool   `json:"stream"`
	// Compact asks the Connector to omit the bulky opening snapshot records and
	// projections. Mobile already has a transcript and only needs live frames.
	Compact bool `json:"compact,omitempty"`
}

type SessionUnfollowParams struct {
	SessionID string `json:"sessionId"`
	FollowID  string `json:"followId"`
}

// ---------- remote interaction (approval / question) relay ----------

const (
	// MethodInteractionRespond routes one phone decision back to the Connector.
	// It is the only method that requires the `approve` scope.
	MethodInteractionRespond = "interaction.respond"

	// KindInteractionRequest and KindInteractionResolved are Connector events.
	KindInteractionRequest  = "interaction.request"
	KindInteractionResolved = "interaction.resolved"

	InteractionKindApproval = "approval"
	InteractionKindQuestion = "question"

	InteractionResolutionRemote    = "remote"
	InteractionResolutionDesktop   = "desktop"
	InteractionResolutionTimeout   = "timeout"
	InteractionResolutionCancelled = "cancelled"
)

// InteractionQuestion mirrors the DSH user-questions form shape. The Connector
// trims it to what a phone can render; it never forwards DSH Host objects.
type InteractionQuestionOption struct {
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

type InteractionQuestion struct {
	ID          string                      `json:"id"`
	Question    string                      `json:"question"`
	Detail      string                      `json:"detail,omitempty"`
	Header      string                      `json:"header,omitempty"`
	Options     []InteractionQuestionOption `json:"options,omitempty"`
	MultiSelect bool                        `json:"multiSelect,omitempty"`
}

// InteractionRequestData is the payload of a Connector interaction.request event.
type InteractionRequestData struct {
	InteractionID string                `json:"interactionId"`
	Kind          string                `json:"kind"`
	DeviceID      string                `json:"deviceId,omitempty"`
	SessionID     string                `json:"sessionId"`
	WorkspaceID   string                `json:"workspaceId"`
	WorkspaceName string                `json:"workspaceName,omitempty"`
	Title         string                `json:"title"`
	ToolName      string                `json:"toolName,omitempty"`
	Reason        string                `json:"reason,omitempty"`
	CallID        string                `json:"callId,omitempty"`
	Questions     []InteractionQuestion `json:"questions,omitempty"`
	CreatedAt     time.Time             `json:"createdAt"`
	ExpiresAt     time.Time             `json:"expiresAt"`
}

// InteractionResolvedData is the payload of a Connector interaction.resolved event.
type InteractionResolvedData struct {
	InteractionID string `json:"interactionId"`
	Resolution    string `json:"resolution"`
}

// InteractionAnswer is one answered question. `custom` overrides single-select
// choices and supplements multi-select choices.
type InteractionAnswer struct {
	ID       string   `json:"id"`
	Selected []string `json:"selected"`
	Custom   string   `json:"custom,omitempty"`
}

// InteractionRespondParams is the Connector command payload for one decision.
type InteractionRespondParams struct {
	InteractionID string              `json:"interactionId"`
	Kind          string              `json:"kind"`
	WorkspaceID   string              `json:"workspaceId,omitempty"`
	Decision      string              `json:"decision,omitempty"`
	Answers       []InteractionAnswer `json:"answers,omitempty"`
}

// MobileInteraction is the phone-facing projection of a pending interaction.
type MobileInteraction struct {
	InteractionID string                `json:"interactionId"`
	Kind          string                `json:"kind"`
	DeviceID      string                `json:"deviceId"`
	DeviceName    string                `json:"deviceName"`
	WorkspaceID   string                `json:"workspaceId"`
	WorkspaceName string                `json:"workspaceName"`
	SessionID     string                `json:"sessionId"`
	Title         string                `json:"title"`
	ToolName      string                `json:"toolName,omitempty"`
	Reason        string                `json:"reason,omitempty"`
	CallID        string                `json:"callId,omitempty"`
	Questions     []InteractionQuestion `json:"questions,omitempty"`
	CreatedAt     time.Time             `json:"createdAt"`
	ExpiresAt     time.Time             `json:"expiresAt"`
}

type MobileInteractionListResponse struct {
	Interactions []MobileInteraction `json:"interactions"`
}

// MobileInteractionDecisionRequest is the body of one phone decision.
type MobileInteractionDecisionRequest struct {
	RequestID string              `json:"requestId"`
	Decision  string              `json:"decision,omitempty"`
	Answers   []InteractionAnswer `json:"answers,omitempty"`
	TimeoutMS int                 `json:"timeoutMs,omitempty"`
}
