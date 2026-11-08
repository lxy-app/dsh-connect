package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/deepseek/dsh-connect/server/internal/protocol"
	"github.com/deepseek/dsh-connect/server/internal/store"
)

const adminSessionConcurrency = 4

// adminSession is deliberately smaller than both protocol.Device and
// protocol.MobileSessionView: operational listings expose metadata only, never
// workspace paths, grants, transcripts or prompt content.
type adminSession struct {
	SessionID     string    `json:"sessionId"`
	Title         string    `json:"title"`
	DeviceID      string    `json:"deviceId"`
	DeviceName    string    `json:"deviceName"`
	WorkspaceID   string    `json:"workspaceId"`
	WorkspaceName string    `json:"workspaceName"`
	Status        string    `json:"status"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type adminSessionListResponse struct {
	Sessions []adminSession                 `json:"sessions"`
	Warnings []protocol.MobileAccessWarning `json:"warnings"`
}

type adminDeviceSessions struct {
	sessions []adminSession
	warning  *protocol.MobileAccessWarning
}

func (s *Server) handleAdminSessions(w http.ResponseWriter, r *http.Request) {
	devices, err := s.store.Devices(r.Context())
	if err != nil {
		writeAPIError(w, protocol.NewError(protocol.CodeInternalError, "could not load devices", true))
		return
	}
	sessions, warnings := s.aggregateAdminSessions(r.Context(), devices)
	writeJSON(w, http.StatusOK, adminSessionListResponse{Sessions: sessions, Warnings: warnings})
}

// aggregateAdminSessions reads session facts only from Connectors. A failed or
// offline desktop contributes a warning while all other desktops remain usable.
func (s *Server) aggregateAdminSessions(ctx context.Context, devices []store.DeviceRecord) ([]adminSession, []protocol.MobileAccessWarning) {
	eligible := make([]store.DeviceRecord, 0, len(devices))
	for _, device := range devices {
		if device.Device.Status == "revoked" || device.Device.Status == "waiting_desktop_authorization" {
			continue
		}
		eligible = append(eligible, device)
	}

	results := make([]adminDeviceSessions, len(eligible))
	semaphore := make(chan struct{}, adminSessionConcurrency)
	var workers sync.WaitGroup
	for index := range eligible {
		workers.Add(1)
		go func() {
			defer workers.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				return
			}
			results[index] = s.listAdminDeviceSessions(ctx, eligible[index])
		}()
	}
	workers.Wait()

	sessions := make([]adminSession, 0)
	warnings := make([]protocol.MobileAccessWarning, 0)
	for _, result := range results {
		sessions = append(sessions, result.sessions...)
		if result.warning != nil {
			warnings = append(warnings, *result.warning)
		}
	}
	sort.Slice(sessions, func(i, j int) bool {
		if !sessions[i].UpdatedAt.Equal(sessions[j].UpdatedAt) {
			return sessions[i].UpdatedAt.After(sessions[j].UpdatedAt)
		}
		if sessions[i].DeviceID != sessions[j].DeviceID {
			return sessions[i].DeviceID < sessions[j].DeviceID
		}
		return sessions[i].SessionID < sessions[j].SessionID
	})
	return sessions, warnings
}

func (s *Server) listAdminDeviceSessions(ctx context.Context, record store.DeviceRecord) adminDeviceSessions {
	device := record.Device
	requestID, err := randomToken("req_")
	if err != nil {
		warning := protocol.MobileAccessWarning{
			DeviceID: device.DeviceID, DeviceName: device.DeviceName,
			Code: protocol.CodeInternalError, Message: "could not generate requestId",
		}
		return adminDeviceSessions{warning: &warning}
	}
	raw, commandError := s.router.Execute(ctx, protocol.MethodSessionList, device.DeviceID, requestID, map[string]any{}, s.config.CommandTimeout)
	if commandError != nil {
		message := "could not list desktop sessions"
		if commandError.Code == protocol.CodeDeviceOffline {
			message = "desktop Connector is offline"
		}
		warning := protocol.MobileAccessWarning{
			DeviceID: device.DeviceID, DeviceName: device.DeviceName,
			Code: commandError.Code, Message: message,
		}
		return adminDeviceSessions{warning: &warning}
	}
	var listed connectorSessionList
	if err := json.Unmarshal(raw, &listed); err != nil {
		warning := protocol.MobileAccessWarning{
			DeviceID: device.DeviceID, DeviceName: device.DeviceName,
			Code: protocol.CodeInternalError, Message: "desktop returned an invalid session list",
		}
		return adminDeviceSessions{warning: &warning}
	}

	workspaces := make(map[string]string, len(device.Workspaces))
	for _, workspace := range device.Workspaces {
		name := workspace.Name
		if name == "" {
			name = workspace.ID
		}
		workspaces[workspace.ID] = name
	}
	sessions := make([]adminSession, 0, len(listed.Sessions))
	for _, summary := range listed.Sessions {
		sessionID := summary.SessionID
		if sessionID == "" {
			sessionID = summary.ID
		}
		workspaceName, authorized := workspaces[summary.WorkspaceID]
		if !validID(sessionID) || !validID(summary.WorkspaceID) || !authorized || summary.UpdatedAt.IsZero() {
			continue
		}
		if summary.Status != "running" && summary.Status != "idle" {
			continue
		}
		title := summary.Title
		if title == "" {
			title = sessionID
		}
		sessions = append(sessions, adminSession{
			SessionID: sessionID, Title: title,
			DeviceID: device.DeviceID, DeviceName: device.DeviceName,
			WorkspaceID: summary.WorkspaceID, WorkspaceName: workspaceName,
			Status: summary.Status, UpdatedAt: summary.UpdatedAt,
		})
	}
	return adminDeviceSessions{sessions: sessions}
}

// adminPendingRequest intentionally omits approval reasons, question forms and
// every other payload field. The overview needs only enough metadata to route an
// operator to the pending interaction.
type adminPendingRequest struct {
	InteractionID string    `json:"interactionId"`
	Kind          string    `json:"kind"`
	Title         string    `json:"title"`
	ToolName      string    `json:"toolName"`
	DeviceID      string    `json:"deviceId"`
	DeviceName    string    `json:"deviceName"`
	SessionID     string    `json:"sessionId"`
	WorkspaceID   string    `json:"workspaceId"`
	CreatedAt     time.Time `json:"createdAt"`
	ExpiresAt     time.Time `json:"expiresAt"`
}

func adminPendingRequests(items []protocol.InteractionRequestData, devices []store.DeviceRecord) []adminPendingRequest {
	deviceNames := make(map[string]string, len(devices))
	for _, device := range devices {
		deviceNames[device.Device.DeviceID] = device.Device.DeviceName
	}
	if len(items) > 5 {
		items = items[:5]
	}
	result := make([]adminPendingRequest, 0, len(items))
	for _, item := range items {
		result = append(result, adminPendingRequest{
			InteractionID: item.InteractionID, Kind: item.Kind, Title: item.Title, ToolName: item.ToolName,
			DeviceID: item.DeviceID, DeviceName: deviceNames[item.DeviceID],
			SessionID: item.SessionID, WorkspaceID: item.WorkspaceID,
			CreatedAt: item.CreatedAt, ExpiresAt: item.ExpiresAt,
		})
	}
	return result
}

type promptTrendPoint struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// buildPromptTrend counts unique prompt admissions with successful Connector
// responses. PromptCompletions supplies one completion per idempotency key; this
// is an admission metric, not a count of completed DSH turns.
func buildPromptTrend(completions []time.Time, now time.Time, location *time.Location) []promptTrendPoint {
	localNow := now.In(location)
	today := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, location)
	start := today.AddDate(0, 0, -6)
	end := today.AddDate(0, 0, 1)
	counts := make(map[string]int, 7)
	for _, completedAt := range completions {
		if completedAt.Before(start) || !completedAt.Before(end) {
			continue
		}
		counts[completedAt.In(location).Format("2006-01-02")]++
	}
	trend := make([]promptTrendPoint, 0, 7)
	for day := start; day.Before(end); day = day.AddDate(0, 0, 1) {
		date := day.Format("2006-01-02")
		trend = append(trend, promptTrendPoint{Date: date, Count: counts[date]})
	}
	return trend
}
