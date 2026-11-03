import type {
  MobileAccessGrant,
  MobileAccessOverview,
  MobileDevice,
  MobileInteraction,
  MobileInteractionAnswer,
  MobileInteractionQuestion,
  MobileMeResponse,
  MobileMessage,
  MobilePlatform,
  MobileSession,
  MobileSessionCreateResult,
  MobileSessionList,
  MobileSessionResponse,
  MobileTranscript,
  MobileUser,
  MobileWorkspaceList,
  MobileWorkspaceSummary,
} from '@/types/mobile';

const API_TIMEOUT_MS = 15_000;

export class MobileApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status = 0, retryable = false) {
    super(message);
    this.name = 'MobileApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

type PairDeviceInput = {
  serverUrl: string;
  code: string;
  deviceName: string;
  platform: MobilePlatform;
  appVersion: string;
};

/** Absolute URL for one attachment's bytes; the phone never sends a path. */
export function buildAttachmentUrl(serverUrl: string, attachmentId: string): string {
  const base = normalizeServerUrl(serverUrl).replace(/\/+$/, '');
  return `${base}/v1/mobile/attachments/${encodeURIComponent(attachmentId)}`;
}

export function normalizeServerUrl(raw: string): string {
  const value = raw.trim();
  if (!value) {
    throw new MobileApiError('invalid_server_url', '请输入 Server 地址。');
  }
  if (value.length > 512) {
    throw new MobileApiError('invalid_server_url', 'Server 地址过长。');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MobileApiError('invalid_server_url', 'Server 地址格式不正确，请包含 http:// 或 https://。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new MobileApiError('invalid_server_url', 'Server 地址只支持 http:// 或 https://。');
  }
  if (!parsed.hostname) {
    throw new MobileApiError('invalid_server_url', 'Server 地址缺少主机名。');
  }
  if (parsed.username || parsed.password) {
    throw new MobileApiError('invalid_server_url', 'Server 地址不能包含账号或密码。');
  }
  if (parsed.search || parsed.hash) {
    throw new MobileApiError('invalid_server_url', 'Server 地址不能包含查询参数或片段。');
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${path === '/' ? '' : path}`;
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof MobileApiError && error.code === 'unauthorized';
}

export function describeMobileApiError(error: unknown): string {
  if (!(error instanceof MobileApiError)) {
    return '操作失败，请稍后重试。';
  }
  switch (error.code) {
    case 'invalid_server_url':
      return error.message;
    case 'network_error':
      return '无法连接 Server，请检查地址、网络和 TLS 配置。';
    case 'timeout':
      return '连接 Server 超时，请检查网络后重试。';
    case 'pairing_code_invalid':
      return '配对码无效。请确认使用的是管理后台“手机配对”生成的二维码或配对码，而不是“桌面配对”码。';
    case 'pairing_code_used':
      return '配对码已被使用，请让管理员重新生成。';
    case 'pairing_code_expired':
      return '配对码已过期，请让管理员重新生成。';
    case 'unauthorized':
      return '凭据无效或已过期，请重新配对。';
    case 'forbidden':
      return '没有执行此操作的权限，或桌面尚未授权这台手机。';
    case 'not_found':
      return 'Server 上找不到该用户、设备或访问授权。';
    case 'device_offline':
      return '桌面离线，暂时无法执行此操作。请确认 DSH 和 Connector 在线。';
    case 'command_timeout':
      return '桌面响应超时，请稍后重试。';
    case 'conflict':
      return '状态已变化，请刷新后重试。';
    case 'idempotency_conflict':
      return '相同请求标识已用于其他内容，请返回后重新进入本页。';
    case 'method_not_found':
    case 'method_not_supported':
    case 'unsupported_method':
      return '桌面 Connector 版本较旧，未提供这项能力。请重启 DSH 桌面以加载最新 Connector，或更新 DSH Connect 插件。';
    case 'workspace_forbidden':
    case 'workspace_mismatch':
      return '这个会话不在当前手机被授权的工作区内。请到设备页检查授权范围。';
    case 'permission_denied':
      return '桌面 Connector 没有授予这项动作。请让桌面补充授权后重试。';
    case 'invalid_request':
      return '请求信息不完整或格式不正确。';
    case 'invalid_response':
      return 'Server 返回了无法识别的响应。';
    case 'payload_too_large':
      return '请求内容过大。';
    case 'internal_error':
      return 'Server 内部错误，请稍后重试。';
    default:
      return error.message || '操作失败，请稍后重试。';
  }
}

export async function pairMobileDevice(input: PairDeviceInput): Promise<MobileSessionResponse> {
  const serverUrl = normalizeServerUrl(input.serverUrl);
  const payload = await requestJSON(serverUrl, '/v1/mobile/pair', {
    method: 'POST',
    body: {
      code: input.code.trim(),
      deviceName: input.deviceName,
      platform: input.platform,
      appVersion: input.appVersion,
    },
  });
  return parseSessionResponse(payload);
}

export async function refreshMobileSession(
  serverUrl: string,
  refreshToken: string,
): Promise<MobileSessionResponse> {
  const payload = await requestJSON(serverUrl, '/v1/mobile/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });
  return parseSessionResponse(payload);
}

export async function getMobileIdentity(
  serverUrl: string,
  accessToken: string,
): Promise<MobileMeResponse> {
  const payload = await requestJSON(serverUrl, '/v1/mobile/me', {
    method: 'GET',
    accessToken,
  });
  return parseMeResponse(payload);
}

export async function logoutMobileDevice(serverUrl: string, accessToken: string): Promise<void> {
  await request(serverUrl, '/v1/mobile/auth/logout', {
    method: 'POST',
    accessToken,
  });
}

export async function getMobileAccessOverview(
  serverUrl: string,
  accessToken: string,
): Promise<MobileAccessOverview> {
  const payload = await requestJSON(serverUrl, '/v1/mobile/access', {
    method: 'GET',
    accessToken,
  });
  return parseAccessOverview(payload);
}

export async function requestMobileAccess(
  serverUrl: string,
  accessToken: string,
  input: { deviceId: string; workspaces: string[]; scopes: string[] },
): Promise<MobileAccessGrant> {
  const payload = await requestJSON(serverUrl, '/v1/mobile/access/requests', {
    method: 'POST',
    accessToken,
    body: input,
  });
  return parseAccessGrant(payload);
}

export async function revokeMobileAccess(
  serverUrl: string,
  accessToken: string,
  grantId: string,
): Promise<void> {
  await request(serverUrl, `/v1/mobile/access/${encodeURIComponent(grantId)}`, {
    method: 'DELETE',
    accessToken,
  });
}

export async function getMobileInteractions(
  serverUrl: string,
  accessToken: string,
  filter: { deviceId?: string; sessionId?: string } = {},
): Promise<MobileInteraction[]> {
  const query = new URLSearchParams();
  if (filter.deviceId) query.set('deviceId', filter.deviceId);
  if (filter.sessionId) query.set('sessionId', filter.sessionId);
  const encoded = query.toString();
  const payload = await requestJSON(serverUrl, `/v1/mobile/interactions${encoded ? `?${encoded}` : ''}`, {
    method: 'GET',
    accessToken,
  });
  if (!isRecord(payload) || !Array.isArray(payload.interactions)) throw invalidResponse();
  return payload.interactions.map(parseInteraction);
}

export async function decideMobileInteraction(
  serverUrl: string,
  accessToken: string,
  interactionId: string,
  input: { requestId: string; decision?: 'allow-once' | 'reject'; answers?: MobileInteractionAnswer[] },
): Promise<void> {
  await request(serverUrl, `/v1/mobile/interactions/${encodeURIComponent(interactionId)}/decision`, {
    method: 'POST',
    accessToken,
    body: input,
  });
}

export async function getMobileWorkspaces(
  serverUrl: string,
  accessToken: string,
): Promise<MobileWorkspaceList> {
  const payload = await requestJSON(serverUrl, '/v1/mobile/workspaces', {
    method: 'GET',
    accessToken,
  });
  return parseWorkspaceList(payload);
}

export async function getMobileSessions(
  serverUrl: string,
  accessToken: string,
  filter: { deviceId?: string; workspaceId?: string } = {},
): Promise<MobileSessionList> {
  const query = new URLSearchParams();
  if (filter.deviceId) query.set('deviceId', filter.deviceId);
  if (filter.workspaceId) query.set('workspaceId', filter.workspaceId);
  const encoded = query.toString();
  const suffix = encoded ? `?${encoded}` : '';
  const payload = await requestJSON(serverUrl, `/v1/mobile/sessions${suffix}`, {
    method: 'GET',
    accessToken,
  });
  return parseSessionList(payload);
}

export async function createMobileSession(
  serverUrl: string,
  accessToken: string,
  input: { requestId: string; deviceId: string; workspaceId: string },
): Promise<MobileSessionCreateResult> {
  const payload = await requestJSON(serverUrl, '/v1/mobile/sessions', {
    method: 'POST',
    accessToken,
    body: input,
  });
  return parseSessionCreate(payload);
}

export async function getMobileTranscript(
  serverUrl: string,
  accessToken: string,
  sessionId: string,
  input: { deviceId: string; workspaceId: string; cursor?: string; limit?: number },
): Promise<MobileTranscript> {
  const query = new URLSearchParams({
    deviceId: input.deviceId,
    workspaceId: input.workspaceId,
  });
  if (input.cursor) query.set('cursor', input.cursor);
  if (input.limit) query.set('limit', String(input.limit));
  const payload = await requestJSON(
    serverUrl,
    `/v1/mobile/sessions/${encodeURIComponent(sessionId)}/messages?${query.toString()}`,
    { method: 'GET', accessToken },
  );
  return parseTranscript(payload);
}

export async function promptMobileSession(
  serverUrl: string,
  accessToken: string,
  sessionId: string,
  input: {
    requestId: string;
    deviceId: string;
    workspaceId: string;
    text: string;
    mode?: 'queue' | 'steer';
  },
): Promise<void> {
  await requestJSON(
    serverUrl,
    `/v1/mobile/sessions/${encodeURIComponent(sessionId)}/prompt`,
    {
      method: 'POST',
      accessToken,
      body: {
        requestId: input.requestId,
        deviceId: input.deviceId,
        workspaceId: input.workspaceId,
        mode: input.mode ?? 'queue',
        text: input.text,
      },
    },
  );
}

export async function cancelMobileSession(
  serverUrl: string,
  accessToken: string,
  sessionId: string,
  input: { requestId: string; deviceId: string; workspaceId: string },
): Promise<void> {
  await requestJSON(
    serverUrl,
    `/v1/mobile/sessions/${encodeURIComponent(sessionId)}/cancel`,
    {
      method: 'POST',
      accessToken,
      body: input,
    },
  );
}

export function createRequestId(prefix = 'mreq'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

async function requestJSON(baseUrl: string, path: string, options: RequestOptions): Promise<unknown> {
  const response = await request(baseUrl, path, options);
  const text = await response.text();
  if (!text) {
    throw new MobileApiError('invalid_response', 'Server 返回了空响应。', response.status);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MobileApiError('invalid_response', 'Server 返回了非 JSON 响应。', response.status);
  }
}

type RequestOptions = {
  method: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  accessToken?: string;
};

async function request(baseUrl: string, path: string, options: RequestOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${normalizeServerUrl(baseUrl)}${path}`, {
      method: options.method,
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new MobileApiError('timeout', '请求 Server 超时。', 0, true);
    }
    throw new MobileApiError(
      'network_error',
      error instanceof Error ? error.message : '无法连接 Server。',
      0,
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    return response;
  }

  let code = response.status === 401 ? 'unauthorized' : 'http_error';
  let message = response.statusText || `HTTP ${response.status}`;
  let retryable = response.status >= 500;
  try {
    const value = (await response.json()) as unknown;
    if (isRecord(value) && isRecord(value.error)) {
      if (typeof value.error.code === 'string') code = value.error.code;
      if (typeof value.error.message === 'string') message = value.error.message;
      if (typeof value.error.retryable === 'boolean') retryable = value.error.retryable;
    }
  } catch {
    // Non-JSON error responses still map to a useful status-based error.
  }
  throw new MobileApiError(code, message, response.status, retryable);
}

function parseSessionResponse(value: unknown): MobileSessionResponse {
  if (!isRecord(value)) {
    throw invalidResponse();
  }
  const response: MobileSessionResponse = {
    mobileDeviceId: requiredString(value.mobileDeviceId),
    user: parseUser(value.user),
    accessToken: requiredString(value.accessToken),
    accessTokenExpiresAt: requiredDate(value.accessTokenExpiresAt),
    refreshToken: requiredString(value.refreshToken),
    refreshTokenExpiresAt: requiredDate(value.refreshTokenExpiresAt),
  };
  return response;
}

function parseMeResponse(value: unknown): MobileMeResponse {
  if (!isRecord(value)) {
    throw invalidResponse();
  }
  return {
    mobileDevice: parseDevice(value.mobileDevice),
    user: parseUser(value.user),
  };
}

function parseDevice(value: unknown): MobileDevice {
  if (!isRecord(value)) {
    throw invalidResponse();
  }
  const platform = value.platform;
  if (platform !== 'ios' && platform !== 'android') {
    throw invalidResponse();
  }
  const status = value.status;
  if (status !== 'active' && status !== 'revoked') {
    throw invalidResponse();
  }
  return {
    mobileDeviceId: requiredString(value.mobileDeviceId),
    userId: requiredString(value.userId),
    deviceName: requiredString(value.deviceName),
    platform,
    appVersion: requiredString(value.appVersion),
    status,
    createdAt: requiredDate(value.createdAt),
    updatedAt: requiredDate(value.updatedAt),
    ...(typeof value.lastSeenAt === 'string' ? { lastSeenAt: requiredDate(value.lastSeenAt) } : {}),
    ...(typeof value.revokedAt === 'string' ? { revokedAt: requiredDate(value.revokedAt) } : {}),
  };
}

function parseUser(value: unknown): MobileUser {
  if (!isRecord(value)) {
    throw invalidResponse();
  }
  return {
    id: requiredString(value.id),
    email: requiredString(value.email),
    displayName: requiredString(value.displayName),
    role: requiredString(value.role),
  };
}


function parseAccessOverview(value: unknown): MobileAccessOverview {
  if (!isRecord(value) || !Array.isArray(value.desktops)) throw invalidResponse();
  return { desktops: value.desktops.map(parseDesktopAccess) };
}

function parseDesktopAccess(value: unknown) {
  if (!isRecord(value)) throw invalidResponse();
  return {
    deviceId: requiredString(value.deviceId),
    deviceName: requiredString(value.deviceName),
    connectorVersion: requiredString(value.connectorVersion),
    online: value.online === true,
    availableWorkspaces: parseWorkspaceSummaries(value.availableWorkspaces),
    availableScopes: parseStringArray(value.availableScopes),
    ...(isRecord(value.grant) ? { grant: parseAccessGrant(value.grant) } : {}),
  };
}

function parseAccessGrant(value: unknown): MobileAccessGrant {
  if (!isRecord(value)) throw invalidResponse();
  const status = value.status;
  if (status !== 'pending' && status !== 'active' && status !== 'denied' && status !== 'revoked') {
    throw invalidResponse();
  }
  return {
    grantId: requiredString(value.grantId),
    ...(typeof value.mobileDeviceId === 'string' ? { mobileDeviceId: value.mobileDeviceId } : {}),
    ...(typeof value.mobileDeviceName === 'string' ? { mobileDeviceName: value.mobileDeviceName } : {}),
    ...(typeof value.mobileUserName === 'string' ? { mobileUserName: value.mobileUserName } : {}),
    ...(typeof value.mobilePlatform === 'string' ? { mobilePlatform: value.mobilePlatform } : {}),
    deviceId: requiredString(value.deviceId),
    ...(typeof value.deviceName === 'string' ? { deviceName: value.deviceName } : {}),
    workspaces: parseWorkspaceSummaries(value.workspaces),
    scopes: parseStringArray(value.scopes),
    status,
    createdAt: requiredDate(value.createdAt),
    updatedAt: requiredDate(value.updatedAt),
    ...(typeof value.decidedAt === 'string' ? { decidedAt: requiredDate(value.decidedAt) } : {}),
  };
}

function parseWorkspaceList(value: unknown): MobileWorkspaceList {
  if (!isRecord(value) || !Array.isArray(value.workspaces)) throw invalidResponse();
  return {
    workspaces: value.workspaces.map((entry) => {
      if (!isRecord(entry)) throw invalidResponse();
      return {
        grantId: requiredString(entry.grantId),
        deviceId: requiredString(entry.deviceId),
        deviceName: requiredString(entry.deviceName),
        workspace: parseWorkspaceSummary(entry.workspace),
        scopes: parseStringArray(entry.scopes),
        online: entry.online === true,
      };
    }),
  };
}

function parseInteraction(value: unknown): MobileInteraction {
  if (!isRecord(value)) throw invalidResponse();
  const questions = Array.isArray(value.questions) ? value.questions.map(parseInteractionQuestion) : [];
  return {
    interactionId: requiredString(value.interactionId),
    kind: requiredString(value.kind),
    deviceId: requiredString(value.deviceId),
    deviceName: typeof value.deviceName === 'string' ? value.deviceName : '',
    workspaceId: requiredString(value.workspaceId),
    workspaceName: typeof value.workspaceName === 'string' ? value.workspaceName : '',
    sessionId: requiredString(value.sessionId),
    title: requiredString(value.title),
    toolName: optionalString(value.toolName),
    reason: optionalString(value.reason),
    callId: optionalString(value.callId),
    ...(questions.length > 0 ? { questions } : {}),
    createdAt: requiredDate(value.createdAt),
    expiresAt: requiredDate(value.expiresAt),
  };
}

function parseInteractionQuestion(value: unknown): MobileInteractionQuestion {
  if (!isRecord(value)) throw invalidResponse();
  const options = Array.isArray(value.options)
    ? value.options.flatMap((option): { label: string; description?: string }[] => {
      if (!isRecord(option) || typeof option.label !== 'string' || option.label.length === 0) return [];
      return [{
        label: option.label,
        ...(typeof option.description === 'string' ? { description: option.description } : {}),
      }];
    })
    : [];
  return {
    id: requiredString(value.id),
    question: requiredString(value.question),
    ...(typeof value.detail === 'string' ? { detail: value.detail } : {}),
    ...(typeof value.header === 'string' ? { header: value.header } : {}),
    ...(options.length > 0 ? { options } : {}),
    ...(value.multiSelect === true ? { multiSelect: true } : {}),
  };
}

function parseSessionList(value: unknown): MobileSessionList {
  if (!isRecord(value) || !Array.isArray(value.sessions)) throw invalidResponse();
  return {
    sessions: value.sessions.map(parseSession),
    warnings: Array.isArray(value.warnings) ? value.warnings.map(parseWarning) : [],
  };
}

function parseSession(value: unknown): MobileSession {
  if (!isRecord(value)) throw invalidResponse();
  return {
    sessionId: requiredString(value.sessionId),
    title: requiredString(value.title),
    workspaceId: requiredString(value.workspaceId),
    workspaceName: requiredString(value.workspaceName),
    deviceId: requiredString(value.deviceId),
    deviceName: requiredString(value.deviceName),
    status: requiredString(value.status),
    scopes: parseStringArray(value.scopes),
    updatedAt: requiredDate(value.updatedAt),
  };
}

function parseSessionCreate(value: unknown): MobileSessionCreateResult {
  if (!isRecord(value)) throw invalidResponse();
  return {
    sessionId: requiredString(value.sessionId),
    workspaceId: requiredString(value.workspaceId),
    ...(typeof value.agentPreset === 'string' && value.agentPreset ? { agentPreset: value.agentPreset } : {}),
  };
}

function parseWarning(value: unknown) {
  if (!isRecord(value)) throw invalidResponse();
  return {
    deviceId: requiredString(value.deviceId),
    deviceName: requiredString(value.deviceName),
    code: requiredString(value.code),
    message: requiredString(value.message),
  };
}

function parseTranscript(value: unknown): MobileTranscript {
  if (!isRecord(value) || !Array.isArray(value.messages)) throw invalidResponse();
  return {
    sessionId: requiredString(value.sessionId),
    deviceId: requiredString(value.deviceId),
    workspaceId: requiredString(value.workspaceId),
    messages: value.messages.map(parseMessage),
    hasMore: value.hasMore === true,
    ...(typeof value.nextCursor === 'string' ? { nextCursor: value.nextCursor } : {}),
    active: value.active === true,
    ...(typeof value.turnEndSeq === 'number' && Number.isSafeInteger(value.turnEndSeq) && value.turnEndSeq > 0 ? { turnEndSeq: value.turnEndSeq } : {}),
    ...(value.truncated === true ? { truncated: true } : {}),
  };
}

function parseMessage(value: unknown): MobileMessage {
  if (!isRecord(value)) throw invalidResponse();
  const role = requiredString(value.role);
  return {
    id: requiredString(value.id),
    seq: typeof value.seq === 'number' && Number.isFinite(value.seq) ? value.seq : 0,
    role,
    text: typeof value.text === 'string' ? value.text : '',
    ...(typeof value.toolName === 'string' ? { toolName: value.toolName } : {}),
    ...(typeof value.toolCallId === 'string' ? { toolCallId: value.toolCallId } : {}),
    ...(value.isError === true ? { isError: true } : {}),
    occurredAt: requiredDate(value.occurredAt),
  };
}

function parseWorkspaceSummaries(value: unknown): MobileWorkspaceSummary[] {
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map(parseWorkspaceSummary);
}

function parseWorkspaceSummary(value: unknown): MobileWorkspaceSummary {
  if (!isRecord(value)) throw invalidResponse();
  return { id: requiredString(value.id), name: requiredString(value.name) };
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map((entry) => {
    if (typeof entry !== 'string') throw invalidResponse();
    return entry;
  });
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw invalidResponse();
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requiredDate(value: unknown): string {
  const date = requiredString(value);
  if (Number.isNaN(Date.parse(date))) {
    throw invalidResponse();
  }
  return date;
}

function invalidResponse(): MobileApiError {
  return new MobileApiError('invalid_response', 'Server 返回的配对响应无效。', 200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
