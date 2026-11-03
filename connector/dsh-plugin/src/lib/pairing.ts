import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  MessageTransport,
  PairingChallenge,
  PairingCompletion,
  PublicChallenge,
  WorkspaceGrants,
} from '../types.js';
import { isRecord } from '../types.js';
import { protocolError } from './request-cache.js';

export type PairingState =
  | 'disconnected'
  | 'waiting_connector'
  | 'waiting_desktop_authorization'
  | 'connected'
  | 'offline'
  | 'authorization_rejected'
  | 'pairing_failed';

export interface PairingTransport extends MessageTransport {
  start(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
}

export interface PairingStore {
  set(key: string, value: unknown): Promise<void>;
  setMany?(values: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface PairingControllerOptions {
  readonly transport: PairingTransport;
  readonly store: PairingStore;
  readonly connectorVersion: string;
  /** Maximum wait for a Server frame after pair.start or pair.authorize is sent. */
  readonly responseTimeoutMs?: number;
}

export interface StartPairingInput {
  readonly pairingCode: string;
  readonly deviceName: string;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

type PendingPairing =
  | { readonly kind: 'start'; readonly requestId: string; readonly deferred: Deferred<PublicChallenge> }
  | { readonly kind: 'authorize'; readonly requestId: string; readonly deferred: Deferred<PairingCompletion> };

/** Explicit two-step desktop pairing; no Host read occurs in this controller. */
export class PairingController extends EventEmitter {
  readonly #transport: PairingTransport;
  readonly #store: PairingStore;
  readonly #connectorVersion: string;
  readonly #responseTimeoutMs: number;
  #state: PairingState = 'disconnected';
  #challenge: PairingChallenge | null = null;
  #pending: PendingPairing | null = null;
  #attempt = 0;

  constructor({ transport, store, connectorVersion, responseTimeoutMs = 15_000 }: PairingControllerOptions) {
    super();
    this.#transport = transport;
    this.#store = store;
    this.#connectorVersion = connectorVersion;
    this.#responseTimeoutMs = responseTimeoutMs;
    transport.on('message', (message: unknown) => void this.#handle(message));
    transport.on('open', () => {
      if (this.#state === 'offline') this.#setState('connected');
    });
    transport.on('state', (state: unknown) => {
      if (state === 'stopped' && this.#state === 'connected') this.#setState('offline');
    });
    transport.on('disconnected', () => {
      this.#attempt += 1;
      if (this.#state !== 'connected' && this.#state !== 'offline') {
        this.#challenge = null;
        void this.#store.set('pendingPairing', null).catch(() => {});
      }
      this.#setState(this.#state === 'connected' ? 'offline' : 'disconnected');
      this.#pending?.deferred.reject(protocolError(
        'pairing_disconnected',
        'Pairing was interrupted; check the Server before retrying',
        true,
      ));
      this.#pending = null;
    });
  }

  get state(): PairingState {
    return this.#state;
  }

  get challenge(): PairingChallenge | null {
    return this.#challenge;
  }

  async startPairing({ pairingCode, deviceName }: StartPairingInput): Promise<PublicChallenge> {
    if (this.#pending) throw protocolError('pairing_in_progress', 'Another pairing action is in progress');
    if (!pairingCode || !deviceName) {
      throw protocolError('invalid_pairing_request', 'Pairing code and desktop name are required');
    }
    if (!this.#transport.connected) await this.#waitUntilOpen();
    const requestId = randomUUID();
    const deferred = makeDeferred<PublicChallenge>();
    this.#attempt += 1;
    const pending: PendingPairing = { kind: 'start', requestId, deferred };
    this.#pending = pending;
    this.#setState('waiting_connector');
    try {
      this.#transport.send({
        v: 1,
        type: 'pair.start',
        requestId,
        pairingCode,
        deviceName,
        connectorVersion: this.#connectorVersion,
      });
    } catch (error) {
      if (this.#pending === pending) this.#pending = null;
      this.#setState('pairing_failed');
      throw error;
    }
    return this.#waitForResponse(pending, deferred.promise);
  }

  async authorize({ workspaces, scopes }: WorkspaceGrants): Promise<PairingCompletion> {
    if (!this.#challenge || this.#state !== 'waiting_desktop_authorization') {
      throw protocolError('invalid_pairing_state', 'A Server challenge must be confirmed first');
    }
    if (this.#pending) throw protocolError('pairing_in_progress', 'Another pairing action is in progress');
    if (!workspaces.length) {
      throw protocolError('invalid_workspace_grant', 'Select at least one workspace before connecting');
    }
    const deferred = makeDeferred<PairingCompletion>();
    const requestId = randomUUID();
    this.#attempt += 1;
    const pending: PendingPairing = { kind: 'authorize', requestId, deferred };
    this.#pending = pending;
    try {
      this.#transport.send({
        v: 1,
        type: 'pair.authorize',
        requestId,
        pairingToken: this.#challenge.pairingToken,
        workspaces,
        scopes,
      });
    } catch (error) {
      if (this.#pending === pending) this.#pending = null;
      this.#setState('pairing_failed');
      throw error;
    }
    return this.#waitForResponse(pending, deferred.promise);
  }

  cancel(): void {
    this.#attempt += 1;
    this.#challenge = null;
    this.#pending?.deferred.reject(protocolError('authorization_rejected', 'Desktop authorization was cancelled'));
    this.#pending = null;
    this.#setState('authorization_rejected');
  }

  async #handle(message: unknown): Promise<void> {
    if (!isRecord(message)) return;
    try {
      if (message.type === 'pair.challenge') {
        const pending = this.#pending;
        const attempt = this.#attempt;
        if (pending?.kind !== 'start' || this.#state !== 'waiting_connector' || message.requestId !== pending.requestId) return;
        const challenge: PairingChallenge = {
          deviceId: message.deviceId as string,
          fingerprint: message.fingerprint as string,
          pairingToken: message.pairingToken as string,
          expiresAt: message.expiresAt as string | undefined,
        };
        await this.#store.set('pendingPairing', challenge);
        // Never let a stale async completion resurrect an invalidated grant.
        if (this.#pending !== pending || this.#attempt !== attempt || this.#state !== 'waiting_connector') return;
        this.#challenge = challenge;
        this.#setState('waiting_desktop_authorization');
        pending.deferred.resolve(this.publicChallenge() as PublicChallenge);
        this.#pending = null;
        return;
      }
      if (message.type === 'pair.complete') {
        const pending = this.#pending;
        if (pending?.kind !== 'authorize' || !this.#challenge || message.requestId !== pending.requestId) return;
        if (!message.deviceToken || !message.deviceId) {
          throw protocolError('invalid_pairing_response', 'Server did not return a device credential');
        }
        const identity = {
          deviceId: message.deviceId,
          deviceToken: message.deviceToken,
          fingerprint: message.fingerprint,
          pendingPairing: null,
        };
        if (this.#store.setMany) await this.#store.setMany(identity);
        else {
          for (const [key, value] of Object.entries(identity)) await this.#store.set(key, value);
        }
        this.#challenge = null;
        this.#setState('connected');
        pending.deferred.resolve({
          deviceId: message.deviceId as string,
          fingerprint: message.fingerprint as string,
        });
        this.#pending = null;
        return;
      }
      if (message.type === 'pair.error' || (message.type === 'error' && this.#pending)) {
        const pending = this.#pending;
        if (!pending || message.requestId !== pending.requestId) return;
        throw remoteError(isRecord(message.error) ? message.error : message);
      }
    } catch (error) {
      this.#pending?.deferred.reject(error);
      this.#pending = null;
      this.#setState('pairing_failed');
      this.emit('pairingError', error);
    }
  }

  async #waitForResponse<T>(pending: PendingPairing, response: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        if (this.#pending !== pending) return;
        // A late pair.complete cannot be trusted after the caller has already
        // failed this attempt. Invalidate the challenge and require a fresh,
        // explicit pairing instead of persisting a credential after timeout.
        this.#attempt += 1;
        this.#pending = null;
        this.#challenge = null;
        void this.#store.set('pendingPairing', null).catch(() => {});
        this.#setState('pairing_failed');
        const error = protocolError(
          'pairing_response_timeout',
          `The Server did not respond to pair.${pending.kind === 'start' ? 'start' : 'authorize'} in time; start pairing again with a new code`,
          true,
        );
        this.emit('pairingError', error);
        reject(error);
      }, this.#responseTimeoutMs);
      timer.unref();
    });
    try {
      return await Promise.race([response, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  publicChallenge(): PublicChallenge | null {
    if (!this.#challenge) return null;
    return {
      deviceId: this.#challenge.deviceId,
      fingerprint: this.#challenge.fingerprint,
      expiresAt: this.#challenge.expiresAt,
    };
  }

  #setState(state: PairingState): void {
    this.#state = state;
    this.emit('state', state);
  }

  async #waitUntilOpen(): Promise<void> {
    if (this.#transport.connected) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(protocolError('server_unreachable', 'Timed out connecting to DSH Connect Server', true));
      }, 10_000);
      const open = (): void => { cleanup(); resolve(); };
      const disconnected = (): void => {
        // The transport retries; only the overall timeout settles this Promise.
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        this.#transport.off('open', open);
        this.#transport.off('disconnected', disconnected);
      };
      this.#transport.on('open', open);
      this.#transport.on('disconnected', disconnected);
      void this.#transport.start();
    });
  }
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function remoteError(error: Readonly<Record<string, unknown>>): Error {
  return protocolError(
    typeof error.code === 'string' ? error.code : 'pairing_failed',
    typeof error.message === 'string' ? error.message : 'The Server rejected desktop pairing',
    error.retryable === true,
  );
}
