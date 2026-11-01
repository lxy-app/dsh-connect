import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { RawData } from 'ws';
import type { Logger, TransportEnvelope } from '../types.js';
import { ReconnectBackoff } from './backoff.js';
import { protocolError } from './request-cache.js';

const OPEN = WebSocket.OPEN;

export interface WebSocketLike extends EventEmitter {
  readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export interface WebSocketOptions {
  readonly headers?: Record<string, string>;
}

export type WebSocketConstructor = new (url: string, options: WebSocketOptions) => WebSocketLike;

export interface ConnectorTransportOptions {
  readonly serverUrl: string;
  readonly getDeviceToken?: () => string | null | undefined | Promise<string | null | undefined>;
  readonly WebSocketImpl?: WebSocketConstructor;
  readonly logger?: Logger;
  readonly heartbeatMs?: number;
  readonly maxPayload?: number;
  readonly backoff?: ReconnectBackoff;
}

/** Owns the desktop's single persistent outbound connection to Go Server. */
export class ConnectorTransport extends EventEmitter {
  readonly #serverUrl: string;
  readonly #getDeviceToken: NonNullable<ConnectorTransportOptions['getDeviceToken']>;
  readonly #WebSocket: WebSocketConstructor;
  readonly #logger: Logger;
  readonly #heartbeatMs: number;
  readonly #maxPayload: number;
  readonly #backoff: ReconnectBackoff;
  #ws: WebSocketLike | null = null;
  #timer: NodeJS.Timeout | null = null;
  #heartbeat: NodeJS.Timeout | null = null;
  #running = false;
  #connecting = false;
  #generation = 0;

  constructor({
    serverUrl,
    getDeviceToken = () => null,
    WebSocketImpl = WebSocket as WebSocketConstructor,
    logger = console,
    heartbeatMs = 20_000,
    maxPayload = 64 * 1024,
    backoff = new ReconnectBackoff(),
  }: ConnectorTransportOptions) {
    super();
    this.#serverUrl = serverUrl;
    this.#getDeviceToken = getDeviceToken;
    this.#WebSocket = WebSocketImpl;
    this.#logger = logger;
    this.#heartbeatMs = heartbeatMs;
    this.#maxPayload = maxPayload;
    this.#backoff = backoff;
  }

  get connected(): boolean {
    return this.#ws?.readyState === OPEN;
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    await this.#connect();
  }

  stop(): void {
    this.#running = false;
    this.#generation += 1;
    this.#connecting = false;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#timer = null;
    this.#heartbeat = null;
    if (this.#ws) {
      const ws = this.#ws;
      this.#ws = null;
      // `ws.close()`/`terminate()` on a still-CONNECTING socket aborts the
      // handshake and emits 'error' asynchronously. Dropping every listener
      // first would turn that into an unhandled 'error' event that crashes the
      // host, so keep a one-shot sink attached until the socket settles.
      ws.on('error', () => undefined);
      ws.removeAllListeners('open');
      ws.removeAllListeners('message');
      ws.removeAllListeners('close');
      ws.removeAllListeners('pong');
      if (ws.readyState === OPEN) {
        ws.close(1000, 'connector stopped');
      } else {
        ws.terminate();
      }
    }
    this.emit('state', 'stopped');
  }

  send(envelope: TransportEnvelope): void {
    const ws = this.#ws;
    if (!ws || ws.readyState !== OPEN) {
      throw protocolError('connector_offline', 'The desktop is not connected to DSH Connect Server', true);
    }
    const payload = JSON.stringify(envelope);
    if (Buffer.byteLength(payload) > this.#maxPayload) {
      throw protocolError('payload_too_large', 'The connector payload exceeds the configured limit');
    }
    if (ws.bufferedAmount > this.#maxPayload * 4) {
      ws.terminate();
      throw protocolError('connector_backpressure', 'The Server is too slow; reconnect and follow a fresh snapshot', true);
    }
    ws.send(payload);
  }

  async #connect(): Promise<void> {
    if (!this.#running || this.#connecting) return;
    this.#connecting = true;
    const generation = ++this.#generation;
    this.emit('state', 'connecting');
    try {
      const url = connectorUrl(this.#serverUrl);
      const token = await this.#getDeviceToken();
      if (!this.#running || generation !== this.#generation) return;
      const options: WebSocketOptions = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
      const ws = new this.#WebSocket(url, options);
      this.#ws = ws;
      ws.on('open', () => {
        if (this.#ws !== ws || generation !== this.#generation) {
          ws.close(1000, 'superseded connection');
          return;
        }
        this.#connecting = false;
        this.#backoff.reset();
        this.#startHeartbeat(ws);
        this.emit('state', 'connected');
        this.emit('open');
      });
      ws.on('message', (rawData: RawData) => {
        if (this.#ws !== ws || generation !== this.#generation) return;
        const data = rawDataBuffer(rawData);
        if (data.length > this.#maxPayload) {
          this.emit('protocolError', protocolError('payload_too_large', 'Incoming payload is too large'));
          ws.close(1009, 'payload too large');
          return;
        }
        try {
          const message: unknown = JSON.parse(data.toString());
          this.emit('message', message);
        } catch {
          this.emit('protocolError', protocolError('invalid_json', 'Server sent invalid JSON'));
        }
      });
      ws.on('error', (error: Error) => {
        if (this.#ws !== ws || generation !== this.#generation) return;
        this.#logger.warn?.('DSH Connect transport error', error.message);
        this.emit('transportError', error);
      });
      ws.on('close', (code: number, reason: Buffer) => {
        if (this.#ws !== ws || generation !== this.#generation) return;
        this.#connecting = false;
        if (this.#heartbeat) clearInterval(this.#heartbeat);
        this.#heartbeat = null;
        this.#ws = null;
        this.emit('state', 'disconnected');
        this.emit('disconnected', { code, reason: reason.toString() });
        this.#scheduleReconnect();
      });
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#connecting = false;
      this.#ws = null;
      this.emit('transportError', error);
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    if (!this.#running || this.#timer) return;
    const delay = this.#backoff.next();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#connect();
    }, delay);
    this.#timer.unref();
  }

  #startHeartbeat(ws: WebSocketLike): void {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    let pong = true;
    ws.on('pong', () => { pong = true; });
    this.#heartbeat = setInterval(() => {
      if (this.#ws !== ws || ws.readyState !== OPEN) return;
      if (!pong) {
        ws.terminate();
        return;
      }
      pong = false;
      ws.ping();
    }, this.#heartbeatMs);
    this.#heartbeat.unref();
  }
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

export function connectorUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Server URL must use http(s) or ws(s)');
  }
  url.pathname = '/v1/connector/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}
