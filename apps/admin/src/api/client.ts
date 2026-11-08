/**
 * Typed client for the DSH Connect admin API.
 *
 * Auth model: the server issues an opaque session token on login. It is kept in
 * memory plus localStorage so a refresh keeps the operator signed in, and sent as
 * `Authorization: Bearer <token>` on every request.
 */

export type Role = 'owner' | 'admin' | 'member' | 'auditor';
export type UserStatus = 'active' | 'disabled';

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
}

export interface Device {
  deviceId: string;
  deviceName: string;
  fingerprint: string;
  connectorVersion: string;
  status: 'online' | 'offline' | 'waiting_desktop_authorization' | 'revoked' | string;
  workspaces: Workspace[];
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  hasToken: boolean;
}

export interface AccessPolicyAuditDetails {
  before?: AccessPolicy;
  after?: AccessPolicy;
}

export interface AuditEntry {
  occurredAt: string;
  actor: string;
  action: string;
  requestId?: string;
  deviceId?: string;
  sessionId?: string;
  result: string;
  errorCode?: string;
  sourceIp?: string;
  details?: AccessPolicyAuditDetails;
}

export interface AdminSession {
  sessionId: string;
  title: string;
  deviceId: string;
  deviceName: string;
  workspaceId: string;
  workspaceName: string;
  status: string;
  updatedAt: string;
}

export interface AdminSessionWarning {
  deviceId: string;
  deviceName: string;
  code: string;
  message: string;
}

export interface SessionsResponse {
  sessions: AdminSession[];
  warnings: AdminSessionWarning[];
}

export interface PendingRequest {
  interactionId: string;
  kind: string;
  title: string;
  toolName: string;
  deviceId: string;
  deviceName: string;
  sessionId: string;
  workspaceId: string;
  createdAt: string;
  expiresAt: string;
}

export interface Overview {
  devices: Record<string, number>;
  users: Record<string, number>;
  auditEntries: number;
  recentActivity: AuditEntry[];
  activeSessions: number;
  todayPrompts: number;
  pendingInteractions: number;
  promptTrend: Array<{ date: string; count: number }>;
  sessions: AdminSession[];
  pendingRequests: PendingRequest[];
  warnings: AdminSessionWarning[];
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: AdminUser;
}

export interface AuditQuery {
  action?: string;
  actor?: string;
  deviceId?: string;
  result?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** A freshly issued desktop pairing code. The plaintext is shown only once. */
export interface PairingCode {
  pairingId: number;
  code: string;
  expiresAt: string;
  serverUrl: string;
}

/** Lifecycle metadata for a previously issued pairing code. */
export interface PairingCodeState {
  pairingId: number;
  state: 'active' | 'waiting_desktop_authorization' | 'used' | 'expired';
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  deviceId?: string;
}

export interface MobilePairingCode {
  code: string;
  expiresAt: string;
  serverUrl: string;
  pairingUrl: string;
  userId: string;
}

export interface MobileDevice {
  mobileDeviceId: string;
  userId: string;
  deviceName: string;
  platform: 'ios' | 'android';
  appVersion: string;
  status: 'active' | 'revoked';
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

export interface AccessPolicyRule {
  deviceId: string;
  workspaceIds: string[];
  scopes: string[];
}

export interface AccessPolicy {
  policyId: string;
  name: string;
  description: string;
  enabled: boolean;
  memberIds: string[];
  rules: AccessPolicyRule[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccessPolicyInput {
  name: string;
  description: string;
  enabled: boolean;
  memberIds: string[];
  rules: AccessPolicyRule[];
}

export interface AccessPreviewDesktop {
  deviceId: string;
  deviceName: string;
  online: boolean;
  workspaces: Array<{ id: string; name: string; scopes: string[] }>;
  scopes: string[];
}

export interface UserAccessPreview {
  userId: string;
  policyIds: string[];
  desktops: AccessPreviewDesktop[];
}

/** API error carrying the server's protocol error code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const STORAGE_KEY = 'dsh-connect.admin.session';

/** Session storage keeps the token across page reloads. */
export const session = {
  read(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  write(token: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch {
      /* private mode: keep the token in memory only */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};

let authToken: string | null = session.read();
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) {
    session.write(token);
  } else {
    session.clear();
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

/** Registers the callback invoked when the server rejects the session. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = extractError(payload);
    if (response.status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    throw new ApiError(error.status ?? response.status, error.code, error.message, error.retryable);
  }
  return payload as T;
}

function extractError(payload: unknown): { status?: number; code: string; message: string; retryable: boolean } {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: { code?: string; message?: string; retryable?: boolean } }).error;
    if (error?.code) {
      return {
        code: error.code,
        message: error.message ?? 'Request failed',
        retryable: Boolean(error.retryable),
      };
    }
  }
  return { code: 'unknown_error', message: 'Request failed', retryable: false };
}

export const adminApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await request<LoginResponse>('/v1/admin/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setAuthToken(response.token);
    return response;
  },

  async logout(): Promise<void> {
    try {
      await request<void>('/v1/admin/auth/logout', { method: 'POST' });
    } finally {
      setAuthToken(null);
    }
  },

  me(signal?: AbortSignal): Promise<AdminUser> {
    return request<AdminUser>('/v1/admin/auth/me', { signal });
  },

  overview(signal?: AbortSignal, timeZone?: string): Promise<Overview> {
    return request<Overview>('/v1/admin/overview', { signal, query: { tz: timeZone } });
  },

  sessions(signal?: AbortSignal): Promise<SessionsResponse> {
    return request<SessionsResponse>('/v1/admin/sessions', { signal });
  },

  async users(signal?: AbortSignal): Promise<AdminUser[]> {
    const response = await request<{ users: AdminUser[] }>('/v1/admin/users', { signal });
    return response.users ?? [];
  },

  createUser(input: { email: string; displayName: string; password: string; role: Role }): Promise<AdminUser> {
    return request<AdminUser>('/v1/admin/users', { method: 'POST', body: input });
  },

  updateUser(
    userId: string,
    input: Partial<{ displayName: string; role: Role; status: UserStatus; password: string }>,
  ): Promise<AdminUser> {
    return request<AdminUser>(`/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: input,
    });
  },

  deleteUser(userId: string): Promise<void> {
    return request<void>(`/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  },

  async policies(signal?: AbortSignal): Promise<AccessPolicy[]> {
    const response = await request<{ policies: AccessPolicy[] }>('/v1/admin/policies', { signal });
    return response.policies ?? [];
  },

  createPolicy(input: AccessPolicyInput): Promise<AccessPolicy> {
    return request<AccessPolicy>('/v1/admin/policies', { method: 'POST', body: input });
  },

  updatePolicy(policyId: string, input: AccessPolicyInput & { revision: number }): Promise<AccessPolicy> {
    return request<AccessPolicy>(`/v1/admin/policies/${encodeURIComponent(policyId)}`, {
      method: 'PATCH',
      body: input,
    });
  },

  deletePolicy(policyId: string, revision: number): Promise<void> {
    return request<void>(`/v1/admin/policies/${encodeURIComponent(policyId)}`, {
      method: 'DELETE',
      query: { revision },
    });
  },

  accessPreview(userId: string, signal?: AbortSignal): Promise<UserAccessPreview> {
    return request<UserAccessPreview>(`/v1/admin/users/${encodeURIComponent(userId)}/access-preview`, { signal });
  },

  async devices(signal?: AbortSignal): Promise<Device[]> {
    const response = await request<{ devices: Device[] }>('/v1/admin/devices', { signal });
    return response.devices ?? [];
  },

  renameDevice(deviceId: string, deviceName: string): Promise<Device> {
    return request<Device>(`/v1/admin/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      body: { deviceName },
    });
  },

  revokeDevice(deviceId: string): Promise<{ status: string }> {
    return request<{ status: string }>(`/v1/admin/devices/${encodeURIComponent(deviceId)}/revoke`, {
      method: 'POST',
    });
  },

  deleteDevice(deviceId: string): Promise<void> {
    return request<void>(`/v1/admin/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
  },

  audit(query: AuditQuery = {}, signal?: AbortSignal): Promise<AuditPage> {
    return request<AuditPage>('/v1/admin/audit', {
      query: {
        action: query.action,
        actor: query.actor,
        deviceId: query.deviceId,
        result: query.result,
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
      },
      signal,
    });
  },

  createPairingCode(): Promise<PairingCode> {
    // Uses the admin-scoped endpoint: /v1/pairing/desktop-codes only accepts the
    // bootstrap token and would reject a browser session.
    return request<PairingCode>('/v1/admin/pairing-codes', { method: 'POST' });
  },

  async pairingCodes(signal?: AbortSignal): Promise<PairingCodeState[]> {
    const response = await request<{ codes: PairingCodeState[] }>('/v1/admin/pairing-codes', { signal });
    return response.codes ?? [];
  },

  createMobilePairingCode(userId?: string): Promise<MobilePairingCode> {
    return request<MobilePairingCode>('/v1/admin/mobile/pairing-codes', {
      method: 'POST',
      body: userId ? { userId } : {},
    });
  },

  async mobileDevices(signal?: AbortSignal): Promise<MobileDevice[]> {
    const response = await request<{ devices: MobileDevice[] }>('/v1/admin/mobile-devices', { signal });
    return response.devices ?? [];
  },

  revokeMobileDevice(mobileDeviceId: string): Promise<{ status: string }> {
    return request<{ status: string }>(
      `/v1/admin/mobile-devices/${encodeURIComponent(mobileDeviceId)}/revoke`,
      { method: 'POST' },
    );
  },
};
