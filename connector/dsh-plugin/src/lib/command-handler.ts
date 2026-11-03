import type { CommandMessage, MessageTransport, TransportEnvelope, UnknownRecord } from '../types.js';
import { errorCode, errorMessage, errorRetryable, isRecord } from '../types.js';
import type {
  SessionCancelParams,
  SessionCreateParams,
  SessionFollowParams,
  SessionListParams,
  SessionPageParams,
  SessionPromptParams,
  SessionAttachmentFetchParams,
  SessionTranscriptParams,
  SessionUnfollowParams,
} from './host-session-adapter.js';
import type { InteractionBridge, InteractionRespondParams } from './interaction-bridge.js';
import { protocolError, RequestCache } from './request-cache.js';

const METHODS = new Set([
  'session.list',
  'session.create',
  'session.page',
  'session.transcript',
  'session.prompt',
  'session.follow',
  'session.unfollow',
  'session.cancel',
  'session.attachment.fetch',
  'interaction.respond',
]);

type SessionMethod = 'list' | 'create' | 'page' | 'transcript' | 'prompt' | 'follow' | 'unfollow' | 'cancel' | 'attachment.fetch';
type CommandMethod = SessionMethod | 'interaction.respond';

export interface CommandContext {
  readonly signal: AbortSignal;
  readonly requestId: string;
}

type HostMethod = (params: UnknownRecord, context: CommandContext) => unknown | Promise<unknown>;

// Method syntax intentionally describes the structural boundary accepted from
// HostSessionAdapter and small test doubles; runtime input remains validated.
export interface CommandHost {
  list?(params: SessionListParams, context: CommandContext): ReturnType<HostMethod>;
  create?(params: SessionCreateParams, context: CommandContext): ReturnType<HostMethod>;
  page?(params: SessionPageParams, context: CommandContext): ReturnType<HostMethod>;
  transcript?(params: SessionTranscriptParams, context: CommandContext): ReturnType<HostMethod>;
  prompt?(params: SessionPromptParams, context: CommandContext): ReturnType<HostMethod>;
  follow?(params: SessionFollowParams, context: CommandContext): ReturnType<HostMethod>;
  unfollow?(params: SessionUnfollowParams, context: CommandContext): ReturnType<HostMethod>;
  cancel?(params: SessionCancelParams, context: CommandContext): ReturnType<HostMethod>;
  'attachment.fetch'?(params: SessionAttachmentFetchParams, context: CommandContext): ReturnType<HostMethod>;
  respondInteraction?(params: InteractionRespondParams): ReturnType<HostMethod>;
}

export interface CommandHandlerOptions {
  readonly transport: MessageTransport;
  readonly host: CommandHost;
  readonly interactions?: Pick<InteractionBridge, 'respond'>;
  readonly cache?: RequestCache;
  readonly maxTimeoutMs?: number;
}

/** Validates, de-duplicates and executes commands on an injected Host adapter. */
export class CommandHandler {
  readonly #transport: MessageTransport;
  readonly #host: CommandHost;
  readonly #cache: RequestCache;
  readonly #interactions: Pick<InteractionBridge, 'respond'> | undefined;
  readonly #maxTimeoutMs: number;
  readonly #controllers = new Map<string, AbortController>();

  constructor({ transport, host, interactions, cache = new RequestCache(), maxTimeoutMs = 120_000 }: CommandHandlerOptions) {
    this.#transport = transport;
    this.#host = host;
    this.#interactions = interactions;
    this.#cache = cache;
    this.#maxTimeoutMs = maxTimeoutMs;
  }

  async handle(input: unknown): Promise<void> {
    if (!isCommand(input)) return;
    const command = input;
    let response: TransportEnvelope;
    try {
      if (!METHODS.has(command.method)) {
        throw protocolError('method_not_found', `Unsupported method: ${command.method}`);
      }
      const result = await this.#cache.execute(
        command.requestId,
        command.method,
        () => this.#execute(command),
        stableSerialize(command.params ?? {}),
      );
      response = { v: 1, type: 'result', requestId: command.requestId, result };
    } catch (error) {
      response = {
        v: 1,
        type: 'error',
        requestId: command.requestId,
        error: {
          code: errorCode(error),
          message: errorMessage(error),
          retryable: errorRetryable(error),
        },
      };
    }
    try {
      this.#transport.send(response);
    } catch (error) {
      // A lost response must not replace an already-completed Host outcome.
      if (errorCode(error) !== 'connector_offline') throw error;
    }
  }

  dispose(error: unknown = protocolError('connector_stopped', 'Connector stopped')): void {
    for (const controller of this.#controllers.values()) controller.abort(error);
    this.#controllers.clear();
  }

  async #execute(command: CommandMessage): Promise<unknown> {
    const method: CommandMethod = command.method === 'interaction.respond'
      ? 'interaction.respond'
      : command.method.slice('session.'.length) as SessionMethod;
    const controller = new AbortController();
    this.#controllers.set(command.requestId, controller);
    const requested = Number(command.timeoutMs ?? this.#maxTimeoutMs);
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > this.#maxTimeoutMs) {
      this.#controllers.delete(command.requestId);
      throw protocolError('invalid_request', `timeoutMs must be between 1 and ${this.#maxTimeoutMs}`);
    }
    const timeoutMs = requested;
    const timer = setTimeout(() => {
      controller.abort(protocolError(
        'command_timeout',
        `${command.method} did not complete within ${timeoutMs}ms`,
      ));
    }, timeoutMs);
    timer.unref();
    try {
      const params: unknown = command.params ?? {};
      const context: CommandContext = { signal: controller.signal, requestId: command.requestId };
      switch (method) {
        case 'list':
          return await this.#requireMethod('list', command.method).call(this.#host, params as SessionListParams, context);
        case 'create':
          return await this.#requireMethod('create', command.method).call(this.#host, params as SessionCreateParams, context);
        case 'page':
          return await this.#requireMethod('page', command.method).call(this.#host, params as SessionPageParams, context);
        case 'transcript':
          return await this.#requireMethod('transcript', command.method).call(this.#host, params as SessionTranscriptParams, context);
        case 'prompt':
          return await this.#requireMethod('prompt', command.method).call(this.#host, params as SessionPromptParams, context);
        case 'follow':
          return await this.#requireMethod('follow', command.method).call(this.#host, params as SessionFollowParams, context);
        case 'unfollow':
          return await this.#requireMethod('unfollow', command.method).call(this.#host, params as SessionUnfollowParams, context);
        case 'cancel':
          return await this.#requireMethod('cancel', command.method).call(this.#host, params as SessionCancelParams, context);
        case 'attachment.fetch':
          return await this.#requireMethod('attachment.fetch', command.method)
            .call(this.#host, params as SessionAttachmentFetchParams, context);
        case 'interaction.respond': {
          if (!this.#interactions) {
            throw protocolError('method_not_found', `Host adapter does not implement ${command.method}`);
          }
          return this.#interactions.respond(params as InteractionRespondParams);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      this.#controllers.delete(command.requestId);
    }
  }

  #requireMethod<K extends SessionMethod>(method: K, commandMethod: string): NonNullable<CommandHost[K]> {
    const handler = this.#host[method];
    if (!handler) {
      throw protocolError('method_not_found', `Host adapter does not implement ${commandMethod}`);
    }
    return handler as NonNullable<CommandHost[K]>;
  }
}

function isCommand(value: unknown): value is CommandMessage {
  return isRecord(value)
    && value.v === 1
    && value.type === 'command'
    && typeof value.requestId === 'string'
    && value.requestId.length > 0
    && typeof value.method === 'string';
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
