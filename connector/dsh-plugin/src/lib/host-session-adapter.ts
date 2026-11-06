import { randomUUID } from 'node:crypto';
import type {
  LlmRuntime,
  ModelSelection,
  SessionController,
  SessionFollowFrame,
  SessionSummary,
  SessionWireEvent,
  SessionWireHeader,
  TurnWindow,
  WorkspaceRegistry,
} from '../host-api.js';
import type {
  ConnectorScope,
  Logger,
  SessionModelCatalogResult,
  SessionModelSelectResult,
  SessionModelSelection,
  TransportEnvelope,
  UnknownRecord,
} from '../types.js';
import { errorCode, errorMessage, isRecord } from '../types.js';
import { AttachmentIndex } from './attachment-index.js';
import { rewriteAttachmentImageLinks } from './attachment-markdown.js';
import { extractAttachmentCandidates } from './attachment-extract.js';
import type { AttachmentCandidate } from './attachment-extract.js';
import { AttachmentFetcher, guessKind, guessMime } from './attachment-fetch.js';
import type { AttachmentByteReader, AttachmentUploader } from './attachment-fetch.js';
import { evaluateAttachmentPath, ATTACHMENT_ERROR_TOO_LARGE } from './attachment-policy.js';
import { CursorJournal } from './cursor-journal.js';
import { modelCatalogInput, modelSelectInput, pageInput, promptInput, sessionAddress } from './input-validation.js';
import type {
  PageInputParams,
  PromptInputParams,
  SessionModelCatalogInputParams,
  SessionModelSelectInputParams,
} from './input-validation.js';
import { protocolError } from './request-cache.js';
import type { WorkspacePolicy } from './workspace-policy.js';

export interface SessionListParams {
  readonly cursor?: string;
  readonly workspaceId?: string;
}

export interface SessionCreateParams {
  readonly workspaceId: string;
  readonly title?: string;
  readonly cwd?: string;
  readonly sessionId?: string;
  readonly agentPreset?: string;
}

export interface SessionPageParams extends PageInputParams {
  readonly workspaceId?: string;
}

export interface SessionTranscriptParams extends PageInputParams {
  readonly workspaceId?: string;
}

export interface TranscriptMessage {
  readonly id: string;
  readonly seq: number;
  readonly role: 'user' | 'assistant' | 'tool';
  readonly text: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly isError?: boolean;
  readonly attachments?: readonly TranscriptAttachment[];
  readonly delivery?: boolean;
  readonly occurredAt: string;
}

/** Display-safe projection; the desktop path never appears here. */
export interface TranscriptAttachment {
  readonly attachmentId: string;
  readonly kind: 'image' | 'file';
  readonly name: string;
  readonly mime: string;
  readonly bytes: number;
  readonly source: 'deliverable' | 'tool';
  readonly description?: string;
  readonly state: 'known' | 'failed' | 'unavailable';
  readonly errorCode?: string;
}

export interface TranscriptResult {
  readonly messages: TranscriptMessage[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
  readonly active: boolean;
  readonly turnEndSeq?: number;
  readonly truncated?: boolean;
}

export interface SessionPromptParams extends PromptInputParams {
  readonly workspaceId?: string;
}

export type SessionModelCatalogParams = SessionModelCatalogInputParams;
export type SessionModelSelectParams = SessionModelSelectInputParams;

export interface SessionAttachmentFetchParams {
  readonly sessionId: unknown;
  readonly workspaceId?: string;
  readonly attachmentId: unknown;
}

export interface SessionCancelParams {
  readonly sessionId: unknown;
  readonly workspaceId?: string;
  readonly reason?: unknown;
}

export interface SessionFollowParams {
  readonly sessionId: unknown;
  readonly workspaceId?: string;
  readonly cursor?: unknown;
  readonly followId?: string;
  readonly maxMessages?: number;
  readonly turnWindow?: TurnWindow;
  readonly compact?: boolean;
}

export interface SessionUnfollowParams {
  readonly sessionId: unknown;
  readonly followId?: string;
}

export interface SessionSummaryView {
  readonly id: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly status: 'running' | 'idle';
  readonly updatedAt: string;
  readonly agentAvailable: boolean;
  readonly blank: boolean;
  readonly formatStatus: string;
}

export interface HostSessionAdapterOptions {
  readonly controller: SessionController;
  readonly llm: LlmRuntime;
  readonly workspaceRegistry: WorkspaceRegistry;
  readonly policy: WorkspacePolicy;
  readonly deviceId: string;
  readonly emit: (event: TransportEnvelope) => void;
  readonly journal?: CursorJournal;
  readonly logger?: Logger;
  readonly attachments?: AttachmentWiring;
}

/** Byte plumbing the Connector runtime supplies; the adapter owns the policy. */
export interface AttachmentWiring {
  readonly index?: AttachmentIndex;
  readonly readBytes: AttachmentByteReader;
  readonly upload: AttachmentUploader;
  readonly maxBytes?: number;
  readonly allowOutsideWorkspace?: boolean;
  readonly toolAllowlist?: readonly string[];
}

interface FollowSubscription {
  readonly controller: AbortController;
  readonly id: string;
}

interface ExternalSessionEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly occurredAt: string;
  readonly data: TransportEnvelope;
}

/** DSH 0.2.x Host adapter. All version-specific Session calls stay in this file. */
export class HostSessionAdapter {
  readonly #controller: SessionController;
  readonly #llm: LlmRuntime;
  readonly #workspaceRegistry: WorkspaceRegistry;
  readonly #policy: WorkspacePolicy;
  readonly #deviceId: string;
  readonly #emit: (event: TransportEnvelope) => void;
  readonly #logger: Logger;
  readonly #journal: CursorJournal;
  readonly #attachments: AttachmentWiring | undefined;
  readonly #attachmentIndex: AttachmentIndex | undefined;
  readonly #attachmentFetcher: AttachmentFetcher | undefined;
  #sessions = new Map<string, string>();
  readonly #watermarks = new Map<string, number>();
  readonly #follows = new Map<string, FollowSubscription>();
  readonly #sessionOperations = new Map<string, Promise<void>>();

  constructor({
    controller,
    llm,
    workspaceRegistry,
    policy,
    deviceId,
    emit,
    journal = new CursorJournal(),
    logger = console,
    attachments,
  }: HostSessionAdapterOptions) {
    this.#controller = controller;
    this.#llm = llm;
    this.#workspaceRegistry = workspaceRegistry;
    this.#policy = policy;
    this.#deviceId = deviceId;
    this.#emit = emit;
    this.#journal = journal;
    this.#logger = logger;
    this.#attachments = attachments;
    if (attachments) {
      this.#attachmentIndex = attachments.index ?? new AttachmentIndex();
      this.#attachmentFetcher = new AttachmentFetcher({
        index: this.#attachmentIndex,
        readBytes: attachments.readBytes,
        upload: attachments.upload,
        maxBytes: attachments.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES,
        resolveWorkspaceRoot: (_sessionId, workspaceId) => this.#workspaceRoot(workspaceId),
      });
    }
  }

  async list(params: SessionListParams, { signal }: { readonly signal: AbortSignal }): Promise<{ readonly sessions: SessionSummaryView[] }> {
    this.#requireScope('read');
    this.#refreshWorkspaces();
    const page = await this.#controller.list({ cursor: params.cursor }, signal);
    const items = page.items.map((summary) => this.#remember(summary))
      .filter((summary): summary is SessionSummaryView => summary !== null
        && this.#policy.allowsWorkspace(summary.workspaceId)
        && (!params.workspaceId || summary.workspaceId === params.workspaceId));
    return { sessions: items };
  }

  async create(params: SessionCreateParams): Promise<TransportEnvelope> {
    if (params.title !== undefined) {
      throw protocolError('unsupported_parameter', 'DSH session.create does not accept a title');
    }
    const workspace = this.#policy.authorize(params.workspaceId, 'prompt');
    if (params.cwd !== undefined) {
      throw protocolError('unsupported_parameter', 'Use an authorized workspaceId; arbitrary cwd is not supported');
    }
    const created = await this.#controller.create({
      workspaceId: workspace.id,
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.agentPreset ? { agentPreset: params.agentPreset } : {}),
    });
    this.#sessions.set(created.sessionId, workspace.id);
    return { ...created, workspaceId: workspace.id };
  }

  async page(params: SessionPageParams, { signal }: { readonly signal: AbortSignal }): Promise<TransportEnvelope> {
    const sessionId = sessionAddress(params.sessionId).sessionId;
    await this.#authorizeSession(sessionId, 'read', params.workspaceId);
    const context = await this.#latestPageContext(sessionId, signal);
    const result = await this.#controller.events({
      ...pageInput(params),
      throughSeq: context.throughSeq,
    }, signal);
    const items = result.records.map((record) => ({
      type: record.type,
      event: this.#externalEvent(record.event, sessionId),
    }));
    const firstSeq = items[0]?.event.seq;
    return {
      items,
      hasMore: result.hasMore,
      ...(result.hasMore && firstSeq !== undefined && firstSeq > 0 ? { nextCursor: String(firstSeq) } : {}),
    };
  }

  /**
   * Mobile-facing stable transcript. DSH event payloads stay inside this
   * adapter; callers receive role/text/tool metadata only.
   */
  async transcript(
    params: SessionTranscriptParams,
    { signal }: { readonly signal: AbortSignal },
  ): Promise<TranscriptResult> {
    const sessionId = sessionAddress(params.sessionId).sessionId;
    const workspaceId = await this.#authorizeSession(sessionId, 'read', params.workspaceId);
    const context = await this.#latestPageContext(sessionId, signal);
    const result = await this.#controller.events({
      ...pageInput(params),
      throughSeq: context.throughSeq,
    }, signal);
    const messages: TranscriptMessage[] = [];
    const messageTurns = new WeakMap<TranscriptMessage, number>();
    let active = false;
    let turnEndSeq = 0;
    let truncated = false;
    let currentTurn = 0;
    let nextTurn = 1;

    for (const record of result.records) {
      const event = record.event;
      const seq = Number(event.seq);
      if (event.type === 'turn/start') {
        const data = isRecord(event.data) ? event.data : {};
        const declaredTurn = typeof data.turn === 'number' ? data.turn : 0;
        currentTurn = Number.isSafeInteger(declaredTurn) && declaredTurn > 0 ? declaredTurn : nextTurn;
        nextTurn = Math.max(nextTurn, currentTurn + 1);
        active = true;
        continue;
      }
      if (event.type === 'turn/end') {
        active = false;
        if (Number.isSafeInteger(seq) && seq > turnEndSeq) turnEndSeq = seq;
        continue;
      }
      // Mobile chat is conversation-only. Raw tool calls, tool results and
      // their arguments stay on the desktop; they are often huge JSON blobs
      // and make the transcript unreadable on a phone.
      if (event.type !== 'user/message' && event.type !== 'assistant/message') continue;
      const data = isRecord(event.data) ? event.data : {};
      if (event.type === 'user/message') {
        // DSH also records injected runtime/time/skill context as user/message.
        // Only actual user-authored turns belong in a chat transcript.
        const source = isRecord(data.source) ? data.source : undefined;
        const kind = typeof source?.kind === 'string' ? source.kind : undefined;
        if (kind !== undefined && kind !== 'user') continue;
      }
      const payload = isRecord(data.message) ? data.message : data;
      const text = messageText(payload.content);
      if (!text) continue;
      const message: TranscriptMessage = {
        id: typeof payload.id === 'string' && payload.id ? payload.id : `message-${seq}`,
        seq,
        role: event.type === 'user/message' ? 'user' : 'assistant',
        text,
        occurredAt: new Date(event.time).toISOString(),
      };
      messages.push(message);
      messageTurns.set(message, currentTurn);
    }

    // Keep the newest conversation and let older content load through the
    // normal cursor path. The previous implementation filled the budget from
    // the oldest record and then dropped the newest replies.
    let total = messages.reduce((sum, message) => sum + message.text.length, 0);
    let firstVisible = 0;
    while (firstVisible < messages.length - 1 && total > MAX_TRANSCRIPT_CHARS) {
      total -= messages[firstVisible]?.text.length ?? 0;
      firstVisible += 1;
    }
    let visible = messages.slice(firstVisible);
    const only = visible[0];
    if (visible.length === 1 && only !== undefined && only.text.length > MAX_TRANSCRIPT_CHARS) {
      const shortened: TranscriptMessage = {
        ...only,
        text: truncate(only.text, MAX_TRANSCRIPT_CHARS),
      };
      visible = [shortened];
      messageTurns.set(shortened, messageTurns.get(only) ?? 0);
      truncated = true;
    }
    if (this.#attachments) {
      await this.#attachDeclarations(sessionId, workspaceId, result.records, visible, messageTurns, signal);
    }
    const droppedOlder = firstVisible > 0;
    const firstRecordSeq = result.records[0]?.event.seq;
    const cursorSeq = visible[0]?.seq ?? firstRecordSeq;
    const hasMore = result.hasMore || droppedOlder;
    return {
      messages: visible,
      hasMore,
      ...(hasMore && cursorSeq !== undefined && cursorSeq > 0 ? { nextCursor: String(cursorSeq) } : {}),
      active: context.running ?? active,
      ...(turnEndSeq > 0 ? { turnEndSeq } : {}),
      ...(truncated ? { truncated: true } : {}),
    };
  }

  async prompt(
    params: SessionPromptParams,
    { signal, requestId }: { readonly signal: AbortSignal; readonly requestId: string },
  ): Promise<TransportEnvelope> {
    const sessionId = sessionAddress(params.sessionId).sessionId;
    await this.#authorizeSession(sessionId, 'prompt', params.workspaceId);
    return this.#serializeSession(sessionId, async () => {
      await this.#authorizeSession(sessionId, 'prompt', params.workspaceId);
      signal.throwIfAborted();
      const result = await this.#controller.prompt(promptInput(params, requestId), signal);
      return { ...result, sessionId, requestId, status: 'accepted' };
    });
  }

  async 'model.catalog'(
    params: SessionModelCatalogParams,
    { signal }: { readonly signal: AbortSignal },
  ): Promise<SessionModelCatalogResult> {
    const input = modelCatalogInput(params);
    const workspaceId = await this.#authorizeSession(input.sessionId, 'read', input.workspaceId);
    const [catalog, projections] = await Promise.all([
      this.#controller.modelCatalog(),
      this.#controller.projections({ sessionId: input.sessionId }, signal),
    ]);
    if (projections === null) throw protocolError('not_found', `Session "${input.sessionId}" was not found`);
    const lastUsed = projections.values.modelSelection?.lastUsed ?? null;
    const next = projections.values.modelSelection?.next ?? null;
    return {
      sessionId: input.sessionId,
      deviceId: this.#deviceId,
      workspaceId,
      default: projectModelSelection(catalog.default),
      lastUsed: lastUsed === null ? null : projectModelSelection(lastUsed),
      next: next === null ? null : projectModelSelection(next),
      effective: projectModelSelection(next ?? catalog.default),
      routableProviders: [...catalog.routableProviders],
      groups: catalog.groups.map((group) => ({
        id: group.id,
        name: group.name,
        models: group.models.map((model) => ({
          id: model.id,
          name: model.name,
          ...model.description === undefined ? {} : { description: model.description },
          ...model.reasoning === undefined ? {} : {
            reasoning: {
              efforts: model.reasoning.efforts.map((effort) => ({ ...effort })),
              ...model.reasoning.defaultEffort === undefined
                ? {}
                : { defaultEffort: model.reasoning.defaultEffort },
            },
          },
          ...model.badge === undefined ? {} : {
            badge: {
              text: typeof model.badge.text === 'string' ? model.badge.text : { ...model.badge.text },
              ...model.badge.tone === undefined ? {} : { tone: model.badge.tone },
            },
          },
        })),
      })),
      failures: catalog.failures.map((failure) => ({
        id: failure.id,
        name: failure.name,
        message: truncate(failure.message || 'Provider models unavailable', 500),
      })),
      projectionKind: projections.kind,
    };
  }

  async 'model.select'(
    params: SessionModelSelectParams,
    { signal, requestId }: { readonly signal: AbortSignal; readonly requestId: string },
  ): Promise<SessionModelSelectResult> {
    const input = modelSelectInput(params);
    const selection: ModelSelection = {
      provider: input.provider,
      model: input.model,
      ...input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort },
    };
    await this.#authorizeSession(input.sessionId, 'prompt', input.workspaceId);
    return this.#serializeSession(input.sessionId, async () => {
      await this.#authorizeSession(input.sessionId, 'prompt', input.workspaceId);
      signal.throwIfAborted();
      const projections = await this.#controller.projections({ sessionId: input.sessionId }, signal);
      if (projections === null) throw protocolError('not_found', `Session "${input.sessionId}" was not found`);
      if (projections.kind === 'migration-required') {
        throw protocolError('session_migration_required', 'Open this Session on the desktop to complete migration before selecting a model');
      }
      const resolved = await this.#controller.resolveAgent(input.sessionId);
      if ('error' in resolved) throwSessionAgentError(resolved.error);
      await this.#requireModel(selection, signal);
      signal.throwIfAborted();
      resolved.agent.model.select(selection);
      return {
        sessionId: input.sessionId,
        requestId,
        selected: projectModelSelection(selection),
      };
    });
  }

  async cancel(params: SessionCancelParams, _context?: { readonly signal?: AbortSignal }): Promise<TransportEnvelope> {
    if (params.reason !== undefined) {
      throw protocolError('unsupported_parameter', 'DSH session.cancel does not accept a reason');
    }
    const sessionId = sessionAddress(params.sessionId).sessionId;
    await this.#authorizeSession(sessionId, 'cancel', params.workspaceId);
    // Host cancel is intentionally synchronous in DSH 0.2.x and has no signal.
    return this.#controller.cancel({ sessionId });
  }

  async follow(
    params: SessionFollowParams,
    { requestId }: { readonly requestId?: string } = {},
  ): Promise<TransportEnvelope> {
    const sessionId = sessionAddress(params.sessionId).sessionId;
    await this.#authorizeSession(sessionId, 'read', params.workspaceId);
    const requestedCursor = Number(params.cursor ?? 0);
    if (!Number.isSafeInteger(requestedCursor) || requestedCursor < 0) {
      throw protocolError('invalid_request', 'follow cursor must be a non-negative safe integer');
    }
    const maxMessages = Math.min(200, Math.max(1, Number(params.maxMessages ?? 50)));
    if (!Number.isSafeInteger(maxMessages)) {
      throw protocolError('invalid_request', 'maxMessages must be an integer');
    }
    const followId = params.followId ?? requestId ?? randomUUID();
    this.#follows.get(sessionId)?.controller.abort(protocolError(
      'follow_superseded', 'A newer follow subscription replaced this one', true,
    ));
    const controller = new AbortController();
    const subscription: FollowSubscription = { controller, id: followId };
    this.#follows.set(sessionId, subscription);
    const iterable = this.#controller.follow({
      address: { kind: 'session', sessionId },
      assistantStream: true,
      maxMessages,
      ...(params.turnWindow ? { turnWindow: params.turnWindow } : {}),
    }, controller.signal);
    void this.#consume(sessionId, subscription, iterable, params.compact === true);
    return { accepted: true, sessionId, requestedCursor, followId, recovery: 'latest_snapshot' };
  }

  async unfollow(params: SessionUnfollowParams): Promise<TransportEnvelope> {
    // Tearing down a local subscription is safe even after grant revocation.
    const sessionId = sessionAddress(params.sessionId).sessionId;
    const current = this.#follows.get(sessionId);
    if (current && current.id === params.followId) {
      current.controller.abort(protocolError('follow_cancelled', 'The last event client disconnected', true));
      this.#follows.delete(sessionId);
    }
    return { accepted: true, sessionId, followId: params.followId, active: false };
  }

  dispose(): void {
    for (const { controller } of this.#follows.values()) {
      controller.abort(protocolError('connector_stopped', 'Connector is stopping'));
    }
    this.#follows.clear();
  }

  async #consume(
    sessionId: string,
    subscription: FollowSubscription,
    iterable: AsyncIterable<SessionFollowFrame>,
    compact: boolean,
  ): Promise<void> {
    const { controller } = subscription;
    try {
      for await (const frame of iterable) {
        if (controller.signal.aborted) break;
        // Registry ownership is mutable; every frame reauthorizes the follow.
        await this.#authorizeSession(sessionId, 'read');
        if (frame.type === 'snapshot') {
          if (frame.header.id !== sessionId) {
            throw protocolError('snapshot_identity_mismatch', 'DSH snapshot does not match the followed session');
          }
          const cursor = Number(frame.cursor ?? 0);
          this.#journal.reset(sessionId, cursor);
          this.#emit(this.#snapshotEvent(sessionId, frame.header, cursor, frame, compact));
        } else if (frame.type === 'event') {
          const event = this.#externalEvent(frame.event, sessionId);
          const previousCursor = this.#journal.cursor(sessionId);
          if (!this.#journal.accept(sessionId, event.seq)) continue;
          try {
            this.#emit({
              v: 1,
              type: 'event',
              eventId: event.eventId,
              deviceId: this.#deviceId,
              sessionId,
              seq: event.seq,
              kind: 'session.event',
              occurredAt: event.occurredAt,
              data: event.data,
            });
          } catch (error) {
            this.#journal.reset(sessionId, previousCursor);
            throw error;
          }
        } else {
          const data = this.#assistantStreamData(frame.frame);
          if (data === null) continue;
          this.#emit({
            v: 1,
            type: 'event',
            eventId: randomUUID(),
            deviceId: this.#deviceId,
            sessionId,
            kind: 'assistant.stream',
            occurredAt: new Date().toISOString(),
            data,
          });
        }
      }
    } catch (error) {
      if (controller.signal.aborted && ['follow_superseded', 'follow_cancelled', 'connector_stopped'].includes(errorCode(controller.signal.reason, ''))) {
        return;
      }
      this.#logger.warn?.('DSH Connect follow failed', error);
      try {
        this.#emit({
          v: 1,
          type: 'event',
          eventId: randomUUID(),
          deviceId: this.#deviceId,
          sessionId,
          kind: errorCode(error) === 'event_sequence_gap' ? 'session.resync_required' : 'connector.error',
          occurredAt: new Date().toISOString(),
          data: { code: errorCode(error, 'follow_failed'), message: errorMessage(error, String(error)) },
        });
      } catch (emitError) {
        this.#logger.warn?.('DSH Connect could not publish follow failure', errorMessage(emitError, String(emitError)));
      }
    } finally {
      if (this.#follows.get(sessionId) === subscription) this.#follows.delete(sessionId);
    }
  }

  #snapshotEvent(
    sessionId: string,
    header: SessionWireHeader,
    cursor: number,
    frame: Extract<SessionFollowFrame, { readonly type: 'snapshot' }>,
    compact: boolean,
  ): TransportEnvelope {
    return {
      v: 1,
      type: 'event',
      eventId: randomUUID(),
      deviceId: this.#deviceId,
      sessionId,
      seq: cursor,
      kind: 'session.snapshot',
      occurredAt: new Date().toISOString(),
      data: compact
        ? { header, cursor, hasMore: frame.hasMore, compact: true }
        : {
          header,
          cursor,
          records: frame.records.map((record) => ({
            type: record.type,
            event: this.#externalEvent(record.event, sessionId),
          })),
          hasMore: frame.hasMore,
          projections: frame.projections,
          ...(frame.assistantStream !== undefined ? { assistantStream: frame.assistantStream } : {}),
        },
    };
  }

  /**
   * Reduce DSH's versioned assistant stream frames to display deltas. Reasoning,
   * tool-call arguments and usage frames stay on the desktop.
   */
  #assistantStreamData(raw: unknown): UnknownRecord | null {
    if (!isRecord(raw)) return null;
    const type = raw.type;
    if (type === 'start') {
      return {
        phase: 'start',
        attemptId: raw.attemptId,
        revision: raw.revision,
        turn: raw.turn,
        step: raw.step,
      };
    }
    if (type === 'end') {
      return {
        phase: 'end',
        attemptId: raw.attemptId,
        revision: raw.revision,
        outcome: raw.outcome,
      };
    }
    if (type !== 'chunk') return null;
    const chunk = isRecord(raw.chunk) ? raw.chunk : undefined;
    if (chunk?.type !== 'text-delta' || typeof chunk.text !== 'string' || chunk.text.length === 0) return null;
    return {
      phase: 'delta',
      attemptId: raw.attemptId,
      revision: raw.revision,
      index: raw.index,
      text: chunk.text,
    };
  }

  #externalEvent(event: SessionWireEvent, fallbackSessionId: string): ExternalSessionEvent {
    const seq = Number(event.seq);
    return {
      eventId: `${this.#deviceId}:${fallbackSessionId}:${seq}`,
      sessionId: fallbackSessionId,
      seq,
      occurredAt: new Date(event.time).toISOString(),
      data: {
        type: event.type,
        payload: event.data,
        ...(event.ignorable ? { ignorable: true } : {}),
        ...(event.sourceEventSeqs !== undefined ? { sourceEventSeqs: event.sourceEventSeqs } : {}),
        ...(event.surfaceOp !== undefined ? { surfaceOp: event.surfaceOp } : {}),
      },
    };
  }

  /**
   * DSH only treats `throughSeq: -1` as "no upper bound" for legacy callers;
   * its history pagination actually slices to `throughSeq + 1`, so passing -1
   * yields an empty page on a real desktop. Resolve the current history
   * watermark first. Listing never activates an Agent, and its projection
   * watermark is the durable cut that `page` accepts.
   */
  async #latestPageContext(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<{ readonly throughSeq: number; readonly running?: boolean }> {
    this.#refreshWorkspaces();
    let listed: { readonly items: readonly SessionSummary[] } | undefined;
    try {
      listed = await this.#controller.list({}, signal);
    } catch (error) {
      // A failed discovery must not break a transcript that can still use the
      // last watermark this adapter saw.
      if (signal.aborted) throw error;
    }
    let summary: SessionSummary | undefined;
    for (const item of listed?.items ?? []) {
      this.#remember(item);
      if (item.sessionId === sessionId) summary = item;
      const watermark = item.projections?.asOfSeq;
      if (typeof watermark === 'number' && Number.isSafeInteger(watermark) && watermark >= 0) {
        this.#watermarks.set(item.sessionId, watermark);
      }
    }
    return {
      throughSeq: this.#watermarks.get(sessionId) ?? 0,
      ...(summary === undefined ? {} : { running: summary.running }),
    };
  }

  /** Serves `session.attachment.fetch`; the index decides what may be read. */
  async 'attachment.fetch'(
    params: SessionAttachmentFetchParams,
    { signal }: { readonly signal: AbortSignal },
  ): Promise<TransportEnvelope> {
    const sessionId = sessionAddress(params.sessionId).sessionId;
    await this.#authorizeSession(sessionId, 'read', params.workspaceId);
    if (!this.#attachmentFetcher) {
      throw protocolError('method_not_found', 'Attachments are disabled on this Connector');
    }
    const attachmentId = typeof params.attachmentId === 'string' ? params.attachmentId : '';
    if (!/^att_[A-Za-z0-9_-]{8,64}$/.test(attachmentId)) {
      throw protocolError('invalid_request', 'attachmentId is required');
    }
    const result = await this.#attachmentFetcher.fetch({ sessionId, attachmentId }, { signal });
    const envelope: TransportEnvelope = {
      status: result.status,
      bytes: result.bytes,
      sha256: result.sha256,
      mime: result.mime,
    };
    return envelope;
  }

  /**
   * Resolves declared paths into display-safe attachments.
   *
   * Paths are evaluated once per transcript: a rejection still produces a
   * declaration, so the phone can explain why a file is unavailable instead of
   * showing an empty message.
   */
  async #attachDeclarations(
    sessionId: string,
    workspaceId: string,
    records: readonly { readonly event: { readonly type: string; readonly seq: unknown; readonly time: unknown; readonly data: unknown } }[],
    messages: TranscriptMessage[],
    messageTurns: WeakMap<TranscriptMessage, number>,
    signal: AbortSignal,
  ): Promise<void> {
    const wiring = this.#attachments;
    const index = this.#attachmentIndex;
    if (!wiring || !index) return;
    const allowOutside = wiring.allowOutsideWorkspace === true;
    const workspaceRoot = this.#workspaceRoot(workspaceId);
    const candidates = extractAttachmentCandidates(records, {
      sessionId,
      ...(wiring.toolAllowlist ? { toolAllowlist: wiring.toolAllowlist } : {}),
    });
    const seen = new Set<string>();
    for (const candidate of candidates.slice(0, MAX_ATTACHMENTS_PER_TRANSCRIPT)) {
      if (seen.has(candidate.attachmentId)) continue;
      seen.add(candidate.attachmentId);
      signal.throwIfAborted();
      const verdict = await evaluateAttachmentPath(candidate.path, {
        workspaceRoot,
        allowOutsideWorkspace: allowOutside,
        maxBytes: wiring.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES,
      });
      const mime = guessMime(candidate.name);
      const attachment: TranscriptAttachment = verdict.ok
        ? {
            attachmentId: candidate.attachmentId,
            kind: guessKind(mime),
            name: candidate.name,
            mime,
            bytes: verdict.bytes,
            source: candidate.source,
            ...(candidate.description ? { description: candidate.description } : {}),
            state: 'known',
          }
        : {
            attachmentId: candidate.attachmentId,
            kind: guessKind(mime),
            name: candidate.name,
            mime,
            bytes: 0,
            source: candidate.source,
            ...(candidate.description ? { description: candidate.description } : {}),
            state: verdict.errorCode === ATTACHMENT_ERROR_TOO_LARGE ? 'failed' : 'unavailable',
            errorCode: verdict.errorCode,
          };
      if (verdict.ok) {
        index.remember({
          attachmentId: candidate.attachmentId,
          sessionId,
          workspaceId,
          source: candidate.source,
          seq: candidate.seq,
          path: verdict.path,
          name: candidate.name,
          ...(candidate.description ? { description: candidate.description } : {}),
          kind: guessKind(mime),
          mime,
          bytes: verdict.bytes,
          baseline: verdict.baseline,
        });
      }
      this.#mountAttachment(messages, messageTurns, candidate, attachment);
    }

    // DSH writes delivered images as Markdown image links to desktop paths.
    // Resolve only exact declarations from the same turn into opaque mobile
    // references; never use a filename-only match or mutate the session log.
    for (const message of messages) {
      if (message.role !== 'assistant' || !message.text.includes('![')) continue;
      const turn = messageTurns.get(message) ?? 0;
      if (turn <= 0) continue;
      const rewritten = rewriteAttachmentImageLinks(
        message.text,
        candidates.filter((candidate) => candidate.turn === turn),
      );
      if (rewritten !== message.text) Object.assign(message, { text: rewritten });
    }
  }

  /** Mounts one attachment on the same turn's last assistant message, or synthesizes one. */
  #mountAttachment(
    messages: TranscriptMessage[],
    messageTurns: WeakMap<TranscriptMessage, number>,
    candidate: AttachmentCandidate,
    attachment: TranscriptAttachment,
  ): void {
    let target: TranscriptMessage | undefined;
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      if (candidate.turn > 0) {
        // A present event normally precedes the final assistant text. Use the
        // declared turn rather than event order, and never borrow the previous
        // turn's reply when this turn has no text of its own.
        if (messageTurns.get(message) === candidate.turn) target = message;
        continue;
      }
      // Compatibility for sources without turn metadata: retain the old
      // sequence-based behaviour only for that legacy case.
      if (message.seq > candidate.seq) break;
      target = message;
    }
    if (target) {
      const merged = [...(target.attachments ?? []), attachment];
      Object.assign(target, { attachments: merged });
      return;
    }
    const delivery: TranscriptMessage = {
      id: `delivery-${candidate.seq}-${candidate.index}`,
      seq: candidate.seq,
      role: 'assistant',
      text: '',
      delivery: true,
      attachments: [attachment],
      occurredAt: candidate.occurredAt,
    };
    messageTurns.set(delivery, candidate.turn);
    const insertAt = messages.findIndex((message) => message.seq > candidate.seq);
    if (insertAt < 0) messages.push(delivery);
    else messages.splice(insertAt, 0, delivery);
  }

  #workspaceRoot(workspaceId: string): string {
    const workspace = this.#workspaceRegistry.list().find((entry) => entry.id === workspaceId);
    return workspace?.path ?? '';
  }

  #refreshWorkspaces(): void {
    const current = new Map<string, string>();
    for (const workspace of this.#workspaceRegistry.list()) {
      for (const sessionId of workspace.sessionIds) {
        current.set(sessionId, workspace.id);
      }
    }
    // Replace rather than merge so moved/detached Sessions lose old grants.
    this.#sessions = current;
  }

  #remember(summary: SessionSummary): SessionSummaryView | null {
    const sessionId = summary.sessionId;
    const workspaceId = this.#sessions.get(sessionId);
    if (!sessionId || !workspaceId) return null;
    const projectedTitle = summary.projections?.values?.title;
    return {
      id: sessionId,
      sessionId,
      workspaceId,
      title: typeof projectedTitle === 'string' ? projectedTitle : sessionId,
      status: summary.running ? 'running' : 'idle',
      updatedAt: new Date(summary.updatedAt).toISOString(),
      agentAvailable: summary.agentAvailable,
      blank: summary.blank,
      formatStatus: summary.formatStatus ?? 'current',
    };
  }

  async #requireModel(selection: ModelSelection, signal: AbortSignal): Promise<void> {
    try {
      if (!this.#llm.listProviders().some((provider) => provider.id === selection.provider)) {
        throw protocolError('model_unavailable', `Provider "${selection.provider}" is not registered`);
      }
      const models = await this.#llm.listModels(selection.provider);
      if (!models.some((model) => model.id === selection.model)) {
        throw protocolError('model_unavailable', `Model "${selection.provider}/${selection.model}" is not in the available catalog`);
      }
      await this.#llm.resolveCallConfig(selection, signal);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (errorCode(error) === 'model_unavailable') throw error;
      throw protocolError(
        'model_unavailable',
        truncate(`Selected model is unavailable: ${errorMessage(error)}`, 500),
      );
    }
  }

  async #serializeSession<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#sessionOperations.get(sessionId) ?? Promise.resolve();
    const run = previous.then(operation);
    const settled = run.then(() => undefined, () => undefined);
    this.#sessionOperations.set(sessionId, settled);
    try {
      return await run;
    } finally {
      if (this.#sessionOperations.get(sessionId) === settled) this.#sessionOperations.delete(sessionId);
    }
  }

  #requireScope(scope: ConnectorScope): void {
    if (!this.#policy.hasScope(scope)) {
      throw protocolError('permission_denied', `Connector scope ${scope} is not granted`);
    }
  }

  async #authorizeSession(sessionId: string, scope: ConnectorScope, claimedWorkspaceId?: string): Promise<string> {
    this.#requireScope(scope);
    sessionAddress(sessionId);
    this.#refreshWorkspaces();
    const workspaceId = this.#sessions.get(sessionId);
    if (!workspaceId || !this.#policy.allowsWorkspace(workspaceId)) {
      throw protocolError('workspace_forbidden', 'The target session is not in an authorized workspace');
    }
    if (claimedWorkspaceId && claimedWorkspaceId !== workspaceId) {
      throw protocolError('workspace_mismatch', 'The target session belongs to a different workspace');
    }
    return workspaceId;
  }
}

function projectModelSelection(selection: ModelSelection): SessionModelSelection {
  return {
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
  };
}

function throwSessionAgentError(error: { readonly code: string; readonly message: string }): never {
  if (error.code === 'session/not-found') throw protocolError('not_found', error.message);
  if (error.code === 'session/writer-held' || error.code === 'session/agent-busy') {
    throw protocolError('conflict', error.message);
  }
  throw error;
}

// Mobile transcript payloads must stay well under the 64 KiB transport limit.
const MAX_TRANSCRIPT_CHARS = 45_000;
const MAX_ATTACHMENTS_PER_TRANSCRIPT = 12;
const DEFAULT_MAX_ATTACHMENT_BYTES = 20 << 20;
const MAX_MESSAGE_CHARS = 4_000;

function truncate(value: string, limit = MAX_MESSAGE_CHARS): string {
  if (limit <= 0) return '';
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function messageText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      parts.push(block.text);
    }
  }
  return truncate(parts.join('\n'));
}
