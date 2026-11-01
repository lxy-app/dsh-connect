import { randomUUID } from 'node:crypto';
import type {
  ApprovalOutcome,
  ApprovalRequest,
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
  HostContext,
  InteractionAgent,
  WorkspaceRegistry,
} from '../host-api.js';
import type { Logger, TransportEnvelope } from '../types.js';
import { protocolError } from './request-cache.js';
import type { WorkspacePolicy } from './workspace-policy.js';

/** How long an actively-watching phone owns the prompt before the desktop takes over. */
const DEFAULT_GRACE_MS = 6_000;
const MAX_QUESTIONS = 8;
const MAX_OPTIONS = 16;
const MAX_LABEL = 512;
const MAX_DETAIL = 4096;

type RelayKind = 'approval' | 'question';

export interface InteractionRespondParams {
  readonly interactionId: string;
  readonly kind: string;
  readonly decision?: string;
  readonly answers?: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[];
}

export interface InteractionBridgeOptions {
  readonly ctx: Pick<HostContext, 'on'>;
  readonly workspaceRegistry: WorkspaceRegistry;
  readonly policy: WorkspacePolicy;
  readonly deviceId: string;
  readonly emit: (event: TransportEnvelope) => void;
  /** True when a granted phone is actively polling for interactions right now. */
  readonly audience?: (workspaceId: string) => Promise<boolean>;
  readonly logger?: Logger;
  readonly graceMs?: number;
}

interface PendingRelay {
  readonly interactionId: string;
  readonly kind: RelayKind;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly questions: readonly AskUserQuestionItem[];
  settled: boolean;
  delegated: boolean;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout | null;
  detachAbort: (() => void) | null;
}

function bounded(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[\r\n]+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.length > limit ? `${trimmed.slice(0, Math.max(1, limit - 1))}…` : trimmed;
}

function sessionOf(agent: InteractionAgent | undefined): string | undefined {
  const id = agent?.session?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Routes DSH approvals and user questions to a phone that is actively watching,
 * without ever leaving two competing prompts on screen.
 *
 * DSH dispatches both seams through a scoped Cordis waterfall whose terminal
 * answerer is the desktop Web client. The bridge registers with `prepend`, but
 * it only takes a request when the Server reports a granted phone polling for
 * interactions. In that case the desktop chain is not started yet: the phone
 * owns the prompt for a short grace period, and the desktop takes over only if
 * the phone does not answer. When no phone is watching, the desktop chain runs
 * untouched and the phone never receives a copy it could not act on.
 */
export class InteractionBridge {
  readonly #ctx: Pick<HostContext, 'on'>;
  readonly #workspaceRegistry: WorkspaceRegistry;
  readonly #policy: WorkspacePolicy;
  readonly #deviceId: string;
  readonly #emit: (event: TransportEnvelope) => void;
  readonly #audience: ((workspaceId: string) => Promise<boolean>) | undefined;
  readonly #logger: Logger;
  readonly #graceMs: number;
  readonly #pending = new Map<string, PendingRelay>();
  readonly #disposers: (() => void)[] = [];
  #attached = false;
  #disposed = false;

  constructor({
    ctx,
    workspaceRegistry,
    policy,
    deviceId,
    emit,
    audience,
    logger = console,
    graceMs,
  }: InteractionBridgeOptions) {
    this.#ctx = ctx;
    this.#workspaceRegistry = workspaceRegistry;
    this.#policy = policy;
    this.#deviceId = deviceId;
    this.#emit = emit;
    this.#audience = audience;
    this.#logger = logger;
    this.#graceMs = typeof graceMs === 'number' && graceMs >= 200 ? graceMs : DEFAULT_GRACE_MS;
  }

  /** Registers both interaction answerers. Safe to call once per runtime. */
  attach(): void {
    if (this.#attached || this.#disposed) return;
    const on = this.#ctx.on;
    if (typeof on !== 'function') {
      this.#logger.warn?.('DSH Connect: Host does not expose interaction events; remote approval stays on the desktop');
      return;
    }
    this.#attached = true;
    this.#disposers.push(this.#ctx.on!('approval/request', ((request: ApprovalRequest, next: () => Promise<unknown>) =>
      this.#relayApproval(request, next)) as never, { prepend: true }));
    this.#disposers.push(this.#ctx.on!('user-questions/request', ((request: AskUserQuestionRequest, next: () => Promise<unknown>) =>
      this.#relayQuestion(request, next)) as never, { prepend: true }));
  }

  /** Result of one phone decision, requested through a Server command. */
  respond(params: InteractionRespondParams): { readonly accepted: true; readonly interactionId: string } {
    const pending = this.#pending.get(params.interactionId);
    if (!pending || pending.settled || pending.delegated) {
      throw protocolError('interaction_not_found', 'The interaction is no longer pending on the desktop');
    }
    if (params.kind !== pending.kind) {
      throw protocolError('interaction_invalid', 'The decision does not match the pending interaction');
    }
    if (pending.kind === 'approval') {
      if (params.decision !== 'allow-once' && params.decision !== 'reject') {
        throw protocolError('interaction_invalid', 'Approval decisions must be allow-once or reject');
      }
      this.#settle(pending, 'remote', params.decision === 'allow-once' ? 'allowed-once' : 'rejected');
    } else {
      const answer = this.#answerOf(pending, params.answers);
      this.#settle(pending, 'remote', answer);
    }
    return { accepted: true, interactionId: params.interactionId };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const dispose of this.#disposers.splice(0)) {
      try {
        dispose();
      } catch {
        // Host disposal must not throw into plugin teardown.
      }
    }
    for (const pending of [...this.#pending.values()]) {
      this.#settle(pending, 'cancelled', undefined, undefined);
    }
  }

  async #relayApproval(request: ApprovalRequest, next: () => Promise<unknown>): Promise<ApprovalOutcome> {
    const sessionId = sessionOf(request.agent);
    const workspaceId = sessionId ? this.#workspaceOf(sessionId) : undefined;
    if (!sessionId || !workspaceId || !this.#canRelay(workspaceId)) return next() as Promise<ApprovalOutcome>;
    return this.#relay(
      'approval',
      {
        sessionId,
        workspaceId,
        title: bounded(request.toolName, MAX_LABEL) ?? '工具审批',
        toolName: bounded(request.toolName, MAX_LABEL),
        reason: bounded(request.displayReason ?? request.reason, MAX_DETAIL),
        callId: bounded(request.callId, 256),
      },
      next,
      request.signal,
    ) as Promise<ApprovalOutcome>;
  }

  async #relayQuestion(request: AskUserQuestionRequest, next: () => Promise<unknown>): Promise<AskUserQuestionAnswer> {
    const sessionId = sessionOf(request.agent);
    const workspaceId = sessionId ? this.#workspaceOf(sessionId) : undefined;
    if (!sessionId || !workspaceId || !this.#canRelay(workspaceId)) return next() as Promise<AskUserQuestionAnswer>;
    const questions = this.#questionsOf(request.questions);
    if (questions.length === 0) return next() as Promise<AskUserQuestionAnswer>;
    return this.#relay(
      'question',
      {
        sessionId,
        workspaceId,
        title: bounded(questions[0]?.header, MAX_LABEL) ?? '需要你的回答',
        callId: bounded(request.wait?.callId, 256),
        questions,
      },
      next,
      request.signal,
    ) as Promise<AskUserQuestionAnswer>;
  }

  async #relay(
    kind: RelayKind,
    view: {
      sessionId: string;
      workspaceId: string;
      title: string;
      toolName?: string;
      reason?: string;
      callId?: string;
      questions?: readonly AskUserQuestionItem[];
    },
    next: () => Promise<unknown>,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    if (!(await this.#watching(view.workspaceId))) return next();

    const interactionId = `int_${randomUUID()}`;
    const pending = this.#open(kind, interactionId, view.sessionId, this.#questionsOf(view.questions ?? []));
    const settled = new Promise<unknown>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    const requestEvent: TransportEnvelope = {
      v: 1,
      type: 'event',
      eventId: `evt_${randomUUID()}`,
      deviceId: this.#deviceId,
      sessionId: view.sessionId,
      kind: 'interaction.request',
      occurredAt: new Date().toISOString(),
      data: {
        interactionId,
        kind,
        sessionId: view.sessionId,
        workspaceId: view.workspaceId,
        workspaceName: this.#workspaceName(view.workspaceId),
        title: view.title,
        ...(view.toolName ? { toolName: view.toolName } : {}),
        ...(view.reason ? { reason: view.reason } : {}),
        ...(view.callId ? { callId: view.callId } : {}),
        ...(view.questions ? { questions: view.questions } : {}),
        createdAt: new Date(pending.createdAt).toISOString(),
        expiresAt: new Date(pending.expiresAt).toISOString(),
      },
    };
    try {
      this.#emit(requestEvent);
    } catch (error) {
      // The desktop chain must never depend on a reachable Server.
      this.#settle(pending, 'local', undefined, undefined);
      this.#logger.warn?.('DSH Connect: interaction was not forwarded to the Server', error);
      return next();
    }

    if (signal !== undefined) {
      if (signal.aborted) {
        this.#settle(pending, 'cancelled', undefined, undefined);
        return settled;
      }
      const onAbort = (): void => this.#settle(pending, 'cancelled', undefined, undefined);
      signal.addEventListener('abort', onAbort, { once: true });
      pending.detachAbort = () => signal.removeEventListener('abort', onAbort);
    }

    // The phone owns the prompt for the grace window. If it does not answer,
    // the desktop takes over and the phone copy is withdrawn first.
    pending.timer = setTimeout(() => {
      void this.#handOff(pending, next);
    }, this.#graceMs);
    pending.timer.unref();
    return settled;
  }

  #open(
    kind: RelayKind,
    interactionId: string,
    sessionId: string,
    questions: readonly AskUserQuestionItem[],
  ): PendingRelay {
    const now = Date.now();
    const pending: PendingRelay = {
      interactionId,
      kind,
      sessionId,
      createdAt: now,
      expiresAt: now + this.#graceMs + 5_000,
      questions,
      settled: false,
      delegated: false,
      resolve: () => undefined,
      reject: () => undefined,
      timer: null,
      detachAbort: null,
    };
    this.#pending.set(interactionId, pending);
    return pending;
  }

  /** Hand the prompt back to the desktop once the phone's window closes. */
  async #handOff(pending: PendingRelay, next: () => Promise<unknown>): Promise<void> {
    if (pending.settled || pending.delegated) return;
    pending.delegated = true;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = null;
    pending.detachAbort?.();
    pending.detachAbort = null;
    this.#pending.delete(pending.interactionId);
    // Withdraw the phone copy before the desktop prompt appears, so the two
    // clients can never both show the same request.
    this.#emitResolution(pending, 'desktop');
    try {
      const value = await Promise.resolve().then(() => next());
      this.#complete(pending, value);
    } catch (error) {
      this.#complete(pending, undefined, error);
    }
  }

  #settle(
    pending: PendingRelay,
    source: 'remote' | 'desktop' | 'cancelled' | 'local',
    value: unknown,
    error?: unknown,
  ): void {
    if (pending.settled) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = null;
    pending.detachAbort?.();
    pending.detachAbort = null;
    this.#pending.delete(pending.interactionId);
    if (source !== 'local') this.#emitResolution(pending, source === 'remote' ? 'remote' : source);
    if (source === 'cancelled') {
      if (pending.kind === 'approval') this.#complete(pending, 'cancelled');
      else this.#complete(pending, undefined, protocolError('interaction_cancelled', 'The request was withdrawn before the user answered'));
      return;
    }
    this.#complete(pending, value, error);
  }

  #complete(pending: PendingRelay, value: unknown, error?: unknown): void {
    if (pending.settled) return;
    pending.settled = true;
    if (error !== undefined) {
      pending.reject(error);
      return;
    }
    pending.resolve(value);
  }

  #emitResolution(pending: PendingRelay, resolution: string): void {
    try {
      this.#emit({
        v: 1,
        type: 'event',
        eventId: `evt_${randomUUID()}`,
        deviceId: this.#deviceId,
        sessionId: pending.sessionId,
        kind: 'interaction.resolved',
        occurredAt: new Date().toISOString(),
        data: { interactionId: pending.interactionId, resolution },
      });
    } catch (error) {
      this.#logger.warn?.('DSH Connect: interaction resolution was not forwarded to the Server', error);
    }
  }

  async #watching(workspaceId: string): Promise<boolean> {
    if (!this.#audience) return false;
    try {
      return await this.#audience(workspaceId);
    } catch (error) {
      this.#logger.warn?.('DSH Connect: interaction audience query failed', error);
      return false;
    }
  }

  #canRelay(workspaceId: string): boolean {
    return this.#policy.hasScope('approve') && this.#policy.allowsWorkspace(workspaceId);
  }

  #workspaceOf(sessionId: string): string | undefined {
    for (const workspace of this.#workspaceRegistry.list()) {
      if (workspace.sessionIds.includes(sessionId)) return workspace.id;
    }
    return undefined;
  }

  #workspaceName(workspaceId: string): string | undefined {
    for (const workspace of this.#workspaceRegistry.list()) {
      if (workspace.id === workspaceId) return bounded(workspace.title, MAX_LABEL);
    }
    return undefined;
  }

  #questionsOf(questions: readonly AskUserQuestionItem[]): AskUserQuestionItem[] {
    const result: AskUserQuestionItem[] = [];
    for (const item of questions.slice(0, MAX_QUESTIONS)) {
      const id = bounded(item.id, 256);
      const question = bounded(item.question, MAX_DETAIL);
      if (!id || !question) continue;
      const options = (item.options ?? []).slice(0, MAX_OPTIONS).flatMap((option) => {
        const label = bounded(option.label, MAX_LABEL);
        if (!label) return [];
        const description = bounded(option.description, MAX_DETAIL);
        return [{ label, ...(description ? { description } : {}) }];
      });
      result.push({
        id,
        question,
        ...(bounded(item.detail, MAX_DETAIL) ? { detail: bounded(item.detail, MAX_DETAIL) } : {}),
        ...(bounded(item.header, MAX_LABEL) ? { header: bounded(item.header, MAX_LABEL) } : {}),
        ...(options.length > 0 ? { options } : {}),
        ...(item.multiSelect === true ? { multiSelect: true } : {}),
      });
    }
    return result;
  }

  #answerOf(
    pending: PendingRelay,
    answers: InteractionRespondParams['answers'],
  ): AskUserQuestionAnswer {
    if (!Array.isArray(answers) || answers.length !== pending.questions.length) {
      throw protocolError('interaction_invalid', 'One answer is required for every question');
    }
    const byId = new Map(pending.questions.map((question) => [question.id, question]));
    const seen = new Set<string>();
    const result = answers.map((answer: { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }) => {
      const question = byId.get(answer.id);
      if (!question) throw protocolError('interaction_invalid', 'Answer does not match a pending question');
      if (seen.has(answer.id)) throw protocolError('interaction_invalid', 'Each question may be answered once');
      seen.add(answer.id);
      const labels = new Set((question.options ?? []).map((option) => option.label));
      const selected = [...new Set(answer.selected)];
      if (selected.length > 16) throw protocolError('interaction_invalid', 'Too many selected options');
      if (!question.multiSelect && selected.length > 1) {
        throw protocolError('interaction_invalid', 'The question accepts a single option');
      }
      for (const label of selected) {
        if (!labels.has(label)) throw protocolError('interaction_invalid', 'Selected option is not offered by the question');
      }
      const custom = bounded(answer.custom, MAX_DETAIL);
      // DSH semantics: a typed answer overrides a single-select choice and
      // supplements the labels of a multi-select question.
      const finalSelected = custom && !question.multiSelect ? [] : selected;
      return { id: answer.id, selected: [...finalSelected], ...(custom ? { custom } : {}) };
    });
    return { answers: result };
  }
}
