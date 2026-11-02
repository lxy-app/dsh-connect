export type UnknownRecord = Record<string, unknown>;
export type TransportEnvelope = Record<string, unknown>;

export const CONNECTOR_SCOPES = ['read', 'prompt', 'approve', 'cancel'] as const;
export type ConnectorScope = (typeof CONNECTOR_SCOPES)[number];

export interface WorkspaceGrant {
  readonly id: string;
  readonly name?: string;
  readonly path?: string;
}

export interface WorkspaceGrants {
  readonly workspaces: readonly WorkspaceGrant[];
  readonly scopes: readonly ConnectorScope[];
}

export interface WorkspaceInfo {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly sessionIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PublicChallenge {
  readonly deviceId: string;
  readonly fingerprint: string;
  readonly expiresAt?: string;
}

export type ConnectorConfigSource = 'ui' | 'environment' | 'default';

export interface ConnectorStatus {
  readonly connectorVersion: string;
  readonly serverUrl: string | null;
  readonly configSource: ConnectorConfigSource;
  readonly deviceId: string | null;
  readonly deviceName: string | null;
  readonly fingerprint: string | null;
  readonly workspaces: readonly WorkspaceGrant[];
  readonly scopes: readonly ConnectorScope[];
  readonly pairingState: string;
  readonly connected: boolean;
  readonly challenge: PublicChallenge | null;
}

export interface PairingChallenge extends PublicChallenge {
  readonly pairingToken: string;
}

export interface PairingCompletion {
  readonly deviceId: string;
  readonly fingerprint: string;
}

export interface CommandMessage {
  readonly v: 1;
  readonly type: 'command';
  readonly requestId: string;
  readonly method: string;
  readonly params?: UnknownRecord;
  readonly timeoutMs?: number;
}

export interface Logger {
  /**
   * Routine, non-failing diagnostics. Used when the Connector deliberately
   * leaves a decision on the desktop, so an operator can tell "no phone was
   * watching" apart from "the relay is broken".
   */
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
}

export interface MessageTransport {
  readonly connected: boolean;
  send(envelope: TransportEnvelope): void;
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

export function errorCode(error: unknown, fallback = 'internal_error'): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : fallback;
}

export function errorMessage(error: unknown, fallback = 'Unknown connector error'): string {
  if (error instanceof Error) return error.message;
  return isRecord(error) && typeof error.message === 'string' ? error.message : fallback;
}

export function errorRetryable(error: unknown): boolean {
  return isRecord(error) && error.retryable === true;
}

/** Desktop-facing view of one phone access decision. */
export interface ConnectorMobileAccessGrant {
  readonly grantId: string;
  readonly mobileDeviceId: string;
  readonly mobileDeviceName?: string;
  readonly mobileUserName?: string;
  readonly mobilePlatform?: string;
  readonly deviceId: string;
  readonly deviceName?: string;
  readonly workspaces: readonly { readonly id: string; readonly name: string }[];
  readonly scopes: readonly ConnectorScope[];
  readonly status: 'pending' | 'active' | 'denied' | 'revoked';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedAt?: string;
}

export interface ConnectorMobileAccessList {
  readonly grants: readonly ConnectorMobileAccessGrant[];
  readonly availableWorkspaces: readonly { readonly id: string; readonly name: string }[];
  readonly availableScopes: readonly ConnectorScope[];
}

export type ConnectorAccessAction = 'allow' | 'deny' | 'revoke';

export interface ConnectorDecisionInput {
  readonly mobileDeviceId: string;
  readonly action: ConnectorAccessAction;
  readonly workspaces?: readonly string[];
  readonly scopes?: readonly ConnectorScope[];
}
