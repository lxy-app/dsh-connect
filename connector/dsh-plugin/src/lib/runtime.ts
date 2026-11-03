import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { RuntimeHostContext } from '../host-api.js';
import type { ConnectorDecisionInput, ConnectorMobileAccessList, Logger, UnknownRecord, WorkspaceGrants, WorkspaceInfo } from '../types.js';
import { isRecord } from '../types.js';
import { CommandHandler } from './command-handler.js';
import type { FileStateStore } from './file-state-store.js';
import { HostSessionAdapter } from './host-session-adapter.js';
import type { AttachmentWiring } from './host-session-adapter.js';
import { InteractionBridge } from './interaction-bridge.js';
import { PairingController } from './pairing.js';
import { protocolError } from './request-cache.js';
import { ConnectorTransport } from './transport.js';
import { WorkspacePolicy } from './workspace-policy.js';

export interface ConnectorRuntimeOptions {
  readonly ctx: RuntimeHostContext;
  readonly store: FileStateStore;
  readonly serverUrl: string;
  readonly connectorVersion: string;
  readonly logger?: Logger;
}

/** Composes pairing, Host adaptation and the single outbound connection. */
export class ConnectorRuntime extends EventEmitter {
  readonly #ctx: RuntimeHostContext;
  readonly #store: FileStateStore;
  readonly #logger: Logger;
  readonly #serverUrl: string;
  readonly #transport: ConnectorTransport;
  readonly #pairing: PairingController;
  readonly #policy = new WorkspacePolicy();
  #host: HostSessionAdapter | null = null;
  #commands: CommandHandler | null = null;
  #interactions: InteractionBridge | null = null;
  readonly #serverRequests = new Map<string, {
    resolve(value: unknown): void;
    reject(error: unknown): void;
    timer: NodeJS.Timeout;
  }>();

  constructor({ ctx, store, serverUrl, connectorVersion, logger = console }: ConnectorRuntimeOptions) {
    super();
    this.#ctx = ctx;
    this.#store = store;
    this.#logger = logger;
    this.#serverUrl = serverUrl;
    this.#transport = new ConnectorTransport({
      serverUrl,
      getDeviceToken: () => store.get('deviceToken'),
      logger,
    });
    this.#pairing = new PairingController({
      transport: this.#transport,
      store,
      connectorVersion,
    });
    this.#transport.on('message', (message: unknown) => {
      if (!isRecord(message)) return;
      if ((message.type === 'result' || message.type === 'error')
        && typeof message.requestId === 'string'
        && this.#serverRequests.has(message.requestId)) {
        this.#settleServerRequest(message);
        return;
      }
      if (message.type !== 'command') return;
      if (!this.#commands) {
        this.#transport.send({
          v: 1,
          type: 'error',
          requestId: message.requestId,
          error: { code: 'desktop_not_authorized', message: 'Desktop authorization is required', retryable: false },
        });
        return;
      }
      void this.#commands.handle(message).catch((error: unknown) => this.#logger.warn?.('Command handling failed', error));
    });
    this.#transport.on('disconnected', () => {
      // DSH remains the source of truth; clients follow a fresh snapshot.
      this.#host?.dispose();
      this.#commands?.dispose(protocolError('connector_offline', 'Server connection was lost', true));
      this.#rejectServerRequests(protocolError('connector_offline', 'Server connection was lost', true));
      this.emit('state', 'offline');
    });
    this.#transport.on('state', (state: unknown) => this.emit('state', state));
    this.#pairing.on('state', (state: unknown) => this.emit('state', state));
  }

  get pairing(): PairingController {
    return this.#pairing;
  }

  get transport(): ConnectorTransport {
    return this.#transport;
  }

  async start(): Promise<void> {
    const [deviceId, workspaces, scopes, deviceToken] = await Promise.all([
      this.#store.get('deviceId'),
      this.#store.get('workspaces'),
      this.#store.get('scopes'),
      this.#store.get('deviceToken'),
    ]);
    if (deviceId && workspaces && scopes) this.#configureHost({ deviceId, workspaces, scopes });
    if (deviceToken) await this.#transport.start();
  }

  async authorize(grants: WorkspaceGrants) {
    const deviceId = this.#pairing.challenge?.deviceId;
    if (!deviceId) throw protocolError('invalid_pairing_state', 'A Server challenge must be confirmed first');
    // Prepare Host before pair.complete closes the first-command race.
    this.#configureHost({ deviceId, ...grants });
    const result = await this.#pairing.authorize(grants);
    await this.#store.setMany({ workspaces: grants.workspaces, scopes: grants.scopes });
    if (result.deviceId !== deviceId) this.#configureHost({ deviceId: result.deviceId, ...grants });
    return result;
  }

  listWorkspaces(): WorkspaceInfo[] {
    return this.#ctx.workspaceRegistry.list().map((workspace) => ({
      id: workspace.id,
      path: workspace.path,
      title: workspace.title,
      sessionIds: workspace.sessionIds,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    }));
  }

  stop(): void {
    this.#interactions?.dispose();
    this.#interactions = null;
    this.#host?.dispose();
    this.#commands?.dispose();
    this.#rejectServerRequests(protocolError('connector_stopped', 'Connector stopped'));
    this.#transport.stop();
  }

  /**
   * Desktop-scoped control-plane query over the same authenticated WSS. Used by
   * the panel to review and decide phone access requests.
   */
  async mobileAccessList(): Promise<ConnectorMobileAccessList> {
    return await this.#callServer('mobile.access.list') as ConnectorMobileAccessList;
  }

  async mobileAccessDecide(input: ConnectorDecisionInput): Promise<unknown> {
    return await this.#callServer('mobile.access.decide', input);
  }

  /** Whether a granted phone is actively waiting for interactions right now. */
  async interactionAudience(workspaceId: string): Promise<boolean> {
    if (!this.#transport.connected) return false;
    const result = await this.#callServer('interaction.audience', { workspaceId }, 2_000);
    return isRecord(result) && result.watching === true;
  }

  /**
   * Replaces this desktop's own grants without re-pairing. The Server already
   * knows this device; the panel's explicit confirmation is the user consent.
   */
  async updateGrants(grants: WorkspaceGrants): Promise<unknown> {
    const deviceId = await this.#store.get('deviceId');
    if (!deviceId) throw protocolError('not_paired', 'Pair this desktop before updating grants');
    // Validates the scope vocabulary before anything is persisted or sent.
    new WorkspacePolicy(grants);
    const result = await this.#callServer('pair.updateGrants', grants);
    await this.#store.setMany({ workspaces: grants.workspaces, scopes: grants.scopes });
    this.#configureHost({ deviceId, workspaces: grants.workspaces, scopes: grants.scopes });
    return result;
  }

  async #callServer(method: string, params: unknown = {}, timeoutMs = 8_000): Promise<unknown> {
    // A WebSocket used for pair.start is open but not authenticated. Never send
    // authenticated control methods until pair.complete has persisted the
    // device identity; older Servers reject the frame and disconnect the
    // pending challenge.
    const deviceId = await this.#store.get('deviceId');
    if (!deviceId) {
      throw protocolError('not_paired', 'Pair and authorize this desktop before using Connector control methods');
    }
    if (!this.#transport.connected) {
      throw protocolError('connector_offline', 'The desktop is not connected to DSH Connect Server', true);
    }
    const requestId = `creq_${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#serverRequests.delete(requestId);
        reject(protocolError('server_timeout', 'The Server did not answer the control request', true));
      }, timeoutMs);
      timer.unref();
      this.#serverRequests.set(requestId, { resolve, reject, timer });
      try {
        this.#transport.send({ v: 1, type: 'request', requestId, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.#serverRequests.delete(requestId);
        reject(error);
      }
    });
  }

  #settleServerRequest(message: UnknownRecord): void {
    const requestId = String(message.requestId);
    const pending = this.#serverRequests.get(requestId);
    if (!pending) return;
    this.#serverRequests.delete(requestId);
    clearTimeout(pending.timer);
    if (message.type === 'error' && isRecord(message.error)) {
      const code = typeof message.error.code === 'string' ? message.error.code : 'server_error';
      const text = typeof message.error.message === 'string' ? message.error.message : 'Server rejected the control request';
      pending.reject(Object.assign(new Error(text), {
        code,
        retryable: message.error.retryable === true,
      }));
      return;
    }
    if (!('result' in message)) {
      pending.reject(protocolError('invalid_response', 'Server response did not include a result'));
      return;
    }
    pending.resolve(message.result);
  }

  #rejectServerRequests(error: unknown): void {
    for (const pending of this.#serverRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#serverRequests.clear();
  }

  /**
   * Connects the attachment pipeline to the Host service and the Server upload
   * endpoint. When the Host offers no workspace-files service the Connector
   * simply declares nothing, rather than reading bytes behind its back.
   */
  #attachmentWiring(): AttachmentWiring | undefined {
    const workspaceFiles = this.#ctx.workspaceFiles;
    if (!workspaceFiles) return undefined;
    const maxBytes = attachmentMaxBytes();
    return {
      maxBytes,
      readBytes: async ({ sessionId, workspaceRoot, path, maxBytes: limit, signal }) => {
        const result = await workspaceFiles.readBytes(
          { sessionId, workspaceRoot },
          path,
          { range: { offset: 0, length: limit } },
          signal,
        );
        if (!result.eof) {
          const tooLarge = new Error('The declared file exceeds the attachment size limit');
          throw Object.assign(tooLarge, { code: 'attachment_too_large', retryable: false });
        }
        return result.data;
      },
      upload: async ({ attachmentId, sessionId, bytes, sha256, signal }) => {
        await this.#uploadAttachment({ attachmentId, sessionId, bytes, sha256, signal });
      },
    };
  }

  async #uploadAttachment(input: {
    readonly attachmentId: string;
    readonly sessionId: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const deviceToken = await this.#store.get('deviceToken');
    if (!deviceToken) throw new Error('Connector is not paired');
    const url = `${this.#serverUrl.replace(/\/$/, '')}/v1/connector/attachments/${encodeURIComponent(input.attachmentId)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deviceToken}`,
        'Content-Type': 'application/octet-stream',
        'X-DSH-Attachment-Session': input.sessionId,
        'X-DSH-Attachment-Bytes': String(input.bytes.byteLength),
        'X-DSH-Attachment-Sha256': input.sha256,
      },
      // Node's fetch accepts any BufferSource; the DOM typing here does not.
      body: input.bytes as unknown as BodyInit,
      signal: input.signal,
    });
    if (!response.ok) {
      throw new Error(`attachment upload failed with status ${response.status}`);
    }
  }

  #configureHost({ deviceId, workspaces, scopes }: WorkspaceGrants & { readonly deviceId: string }): void {
    this.#interactions?.dispose();
    this.#host?.dispose();
    this.#commands?.dispose(protocolError('connector_reconfigured', 'Connector Host configuration changed'));
    this.#policy.replace({ workspaces, scopes });
    const attachments = this.#attachmentWiring();
    this.#host = new HostSessionAdapter({
      controller: this.#ctx.sessionController,
      workspaceRegistry: this.#ctx.workspaceRegistry,
      policy: this.#policy,
      deviceId,
      emit: (event) => this.#transport.send(event),
      logger: this.#logger,
      ...(attachments ? { attachments } : {}),
    });
    this.#interactions = new InteractionBridge({
      ctx: this.#ctx,
      workspaceRegistry: this.#ctx.workspaceRegistry,
      policy: this.#policy,
      deviceId,
      emit: (event) => this.#transport.send(event),
      logger: this.#logger,
      audience: (workspaceId) => this.interactionAudience(workspaceId),
      graceMs: interactionGraceMs(),
    });
    this.#interactions.attach();
    this.#commands = new CommandHandler({
      transport: this.#transport,
      host: this.#host,
      interactions: this.#interactions,
    });
  }
}

function attachmentMaxBytes(): number {
  const raw = process.env.DSH_CONNECT_MAX_ATTACHMENT_BYTES;
  if (!raw) return 20 << 20;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 20 << 20;
}

function interactionGraceMs(): number | undefined {
  const raw = process.env.DSH_CONNECT_INTERACTION_GRACE_MS;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 30_000 ? parsed : undefined;
}
