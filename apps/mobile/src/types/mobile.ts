export type MobilePlatform = 'ios' | 'android';

export type MobileUser = {
  id: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin' | 'member' | 'auditor' | string;
};

export type MobileDevice = {
  mobileDeviceId: string;
  userId: string;
  deviceName: string;
  platform: MobilePlatform;
  appVersion: string;
  status: 'active' | 'revoked';
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
};

export type MobileSessionResponse = {
  mobileDeviceId: string;
  user: MobileUser;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

export type MobileMeResponse = {
  mobileDevice: MobileDevice;
  user: MobileUser;
};

export type StoredMobileSession = {
  version: 1;
  serverUrl: string;
  mobileDeviceId: string;
  deviceName: string;
  user: MobileUser;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

export type MobileWorkspaceSummary = {
  id: string;
  name: string;
};

export type MobileAccessGrant = {
  grantId: string;
  mobileDeviceId?: string;
  mobileDeviceName?: string;
  mobileUserName?: string;
  mobilePlatform?: string;
  deviceId: string;
  deviceName?: string;
  workspaces: MobileWorkspaceSummary[];
  scopes: string[];
  status: 'pending' | 'active' | 'denied' | 'revoked';
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
};

export type MobileDesktopAccess = {
  deviceId: string;
  deviceName: string;
  connectorVersion: string;
  online: boolean;
  availableWorkspaces: MobileWorkspaceSummary[];
  availableScopes: string[];
  grant?: MobileAccessGrant;
};

export type MobileAccessOverview = {
  desktops: MobileDesktopAccess[];
};

export type MobileWorkspaceView = {
  grantId: string;
  deviceId: string;
  deviceName: string;
  workspace: MobileWorkspaceSummary;
  scopes: string[];
  online: boolean;
};

export type MobileWorkspaceList = {
  workspaces: MobileWorkspaceView[];
};

export type MobileSession = {
  sessionId: string;
  title: string;
  workspaceId: string;
  workspaceName: string;
  deviceId: string;
  deviceName: string;
  status: 'running' | 'idle' | string;
  scopes: string[];
  updatedAt: string;
};

export type MobileAccessWarning = {
  deviceId: string;
  deviceName: string;
  code: string;
  message: string;
};

export type MobileSessionList = {
  sessions: MobileSession[];
  warnings: MobileAccessWarning[];
};

export type MobileSessionCreateResult = {
  sessionId: string;
  workspaceId: string;
  agentPreset?: string;
};

export type MobileMessage = {
  id: string;
  seq: number;
  role: 'user' | 'assistant' | 'tool' | string;
  text: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  occurredAt: string;
};

export type MobileTranscript = {
  sessionId: string;
  deviceId: string;
  workspaceId: string;
  messages: MobileMessage[];
  hasMore: boolean;
  nextCursor?: string;
  active: boolean;
  turnEndSeq?: number;
  truncated?: boolean;
};

export type MobileSessionPromptInput = {
  requestId: string;
  deviceId: string;
  workspaceId: string;
  mode: 'queue' | 'steer';
  text: string;
};

export type MobileInteractionOption = {
  label: string;
  description?: string;
};

export type MobileInteractionQuestion = {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: MobileInteractionOption[];
  multiSelect?: boolean;
};

/** A pending DSH approval or user question forwarded by the desktop Connector. */
export type MobileInteraction = {
  interactionId: string;
  kind: 'approval' | 'question' | string;
  deviceId: string;
  deviceName: string;
  workspaceId: string;
  workspaceName: string;
  sessionId: string;
  title: string;
  toolName?: string;
  reason?: string;
  callId?: string;
  questions?: MobileInteractionQuestion[];
  createdAt: string;
  expiresAt: string;
};

export type MobileInteractionAnswer = {
  id: string;
  selected: string[];
  custom?: string;
};
