import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger, UnknownRecord } from './types.js';

/** The DSH 0.2.1-rc.5 Host surface consumed by this connector. */
export interface SessionAddress {
  readonly kind: 'session';
  readonly sessionId: string;
}

export interface TurnWindow {
  readonly minMessages: number;
  readonly minTurns: number;
}

export interface SessionWireEvent {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: unknown;
  readonly ignorable?: true;
  readonly sourceEventSeqs?: unknown;
  readonly surfaceOp?: unknown;
}

export interface SessionEventEntry {
  readonly type: 'event';
  readonly event: SessionWireEvent;
}

export interface SessionWireHeader {
  readonly id: string;
  readonly createdAt: number;
  readonly version: number;
  readonly isSeeded: boolean;
  readonly [key: string]: unknown;
}

export interface SessionProjectionBaseline {
  readonly asOfSeq: number;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly updatedAt: number;
  readonly running: boolean;
  readonly blank: boolean;
  readonly agentAvailable: boolean;
  readonly formatStatus?: 'current' | 'migration-required';
  readonly projections?: {
    readonly kind?: string;
    readonly asOfSeq?: number;
    readonly values?: Readonly<Record<string, unknown>>;
  };
}

export type SessionFollowFrame =
  | {
      readonly type: 'snapshot';
      readonly header: SessionWireHeader;
      readonly cursor: number;
      readonly records: readonly SessionEventEntry[];
      readonly hasMore: boolean;
      readonly projections: SessionProjectionBaseline;
      readonly assistantStream?: unknown;
    }
  | SessionEventEntry
  | {
      readonly type: 'assistant-stream';
      readonly frame: unknown;
    };

export interface SessionListRequest {
  readonly cursor?: string;
}

export interface SessionCreateRequest {
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly agentPreset?: string;
}

export interface SessionCreateValue {
  readonly sessionId: string;
  readonly agentPreset?: string;
}

export interface SessionPageRequest {
  readonly address: SessionAddress;
  readonly throughSeq: number;
  readonly beforeSeq?: number;
  readonly maxMessages?: number;
  readonly turnWindow?: TurnWindow;
}

export interface SessionPage {
  readonly records: readonly SessionEventEntry[];
  readonly hasMore: boolean;
}

export interface SessionPromptRequest {
  readonly requestId: string;
  readonly sessionId: string;
  readonly mode: 'queue' | 'steer';
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly clientTimeZone?: string;
}

export interface SessionFollowRequest {
  readonly address: SessionAddress;
  readonly assistantStream?: true;
  readonly maxMessages?: number;
  readonly turnWindow?: TurnWindow;
}

export interface SessionController {
  list(request: SessionListRequest, signal: AbortSignal): Promise<{ readonly items: readonly SessionSummary[] }>;
  create(request: SessionCreateRequest): Promise<SessionCreateValue>;
  page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage>;
  prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<{ readonly accepted: boolean }>;
  cancel(request: { readonly sessionId: string }): { readonly accepted: boolean };
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame>;
}

export interface HostWorkspace {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly sessionIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceRegistry {
  list(): HostWorkspace[];
}

export interface Peer {
  readonly principal: { readonly kind: string };
}

export type PeerAdmission = { readonly peer: Peer } | { readonly rejection: 401 | 403 };

export interface WebRoute {
  readonly kind: 'exact' | 'prefix';
  readonly path: string;
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
}

export interface HostConnection {
  admit(request: Pick<IncomingMessage, 'headers'>): PeerAdmission;
}

export interface HostWebServer {
  register(route: WebRoute): () => void;
  /** Legacy 0.2.x diagnostic hook; not part of the stable public Service. */
  match?(path: string): unknown;
}

/**
 * The DSH workspace-files service (Cordis name `workspaceFiles`). Byte reads go
 * through it so the Host's sandbox policy applies; the Connector never falls
 * back to raw `fs` when it refuses.
 */
export interface WorkspaceFileScope {
  readonly sessionId: string;
  readonly workspaceRoot: string;
}

export interface WorkspaceFileBytes {
  readonly data: Uint8Array;
  readonly offset: number;
  readonly eof: boolean;
  readonly bytes: number;
}

export interface WorkspaceFilesService {
  readBytes(
    scope: WorkspaceFileScope,
    path: string,
    options: { readonly range?: { readonly offset?: number; readonly length?: number } },
    signal: AbortSignal,
  ): Promise<WorkspaceFileBytes>;
  stat(scope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<{ readonly path: string; readonly bytes: number }>;
}

export interface HostContext {
  readonly sessionController: SessionController;
  readonly workspaceRegistry: WorkspaceRegistry;
  readonly connection: HostConnection;
  readonly webServer: HostWebServer;
  readonly workspaceFiles?: WorkspaceFilesService;
  readonly logger?: Logger;
  provide(name: string, service: unknown): void;
  effect(register: () => void | (() => void), description?: string): void;
  /**
   * Cordis event subscription used by the approval and user-questions
   * waterfalls. Optional so hosts without the interaction seams keep loading;
   * the Connector then simply leaves interaction routing to the desktop.
   */
  on?(name: string, listener: (...args: never[]) => unknown, options?: { readonly prepend?: boolean }): () => void;
}

export type RuntimeHostContext = Pick<HostContext, 'sessionController' | 'workspaceRegistry' | 'on' | 'workspaceFiles'>;

/** Minimal agent identity carried by DSH interaction requests. */
export interface InteractionAgent {
  readonly session: { readonly id: string };
}

/** DSH `approval/request` outcome vocabulary. Only `allowed-once` grants. */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

/** The approval request fields the Connector may read (no Host objects escape). */
export interface ApprovalRequest {
  readonly agent?: InteractionAgent;
  readonly toolName: string;
  readonly callId?: string;
  readonly reason?: string;
  readonly displayReason?: string;
  readonly signal?: AbortSignal;
}

export interface AskUserQuestionOption {
  readonly label: string;
  readonly description?: string;
}

export interface AskUserQuestionItem {
  readonly id: string;
  readonly question: string;
  readonly detail?: string;
  readonly header?: string;
  readonly options?: readonly AskUserQuestionOption[];
  readonly multiSelect?: boolean;
}

export interface AskUserQuestionRequest {
  readonly questions: readonly AskUserQuestionItem[];
  readonly agent?: InteractionAgent;
  readonly signal?: AbortSignal;
  readonly wait?: { readonly callId: string; readonly timed?: boolean };
}

export interface AskUserQuestionAnswerItem {
  readonly id: string;
  readonly selected: readonly string[];
  readonly custom?: string;
}

export interface AskUserQuestionAnswer {
  readonly answers: readonly AskUserQuestionAnswerItem[];
}

export interface ClientRequestMessage {
  readonly type: 'client-request';
  readonly rpcId: string;
  readonly method: string;
  readonly payload?: unknown;
}

export type RpcResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } };

export type ConnectorRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  peer: Peer,
) => Promise<RpcResult>;

export type RpcRequest = IncomingMessage & { readonly admission?: PeerAdmission };
export type RpcResponse = ServerResponse;
export type RpcPayload = UnknownRecord;
