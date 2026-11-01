import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ConnectorTransport, connectorUrl } from '../src/lib/transport.js';
import type {
  ConnectorTransportOptions,
  WebSocketLike,
  WebSocketOptions,
} from '../src/lib/transport.js';

class FakeWebSocket extends EventEmitter implements WebSocketLike {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly bufferedAmount = 0;
  readonly sent: string[] = [];
  readonly url: string;
  readonly options: WebSocketOptions;
  readyState = 0;
  pings = 0;

  constructor(url: string, options: WebSocketOptions) {
    super();
    this.url = url;
    this.options = options;
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  send(data: string): void {
    this.sent.push(data);
  }

  ping(): void {
    this.pings += 1;
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.emit('close', code, Buffer.from(reason ?? ''));
  }

  terminate(): void {
    this.close(1006, 'terminated');
  }
}

function transport(overrides: Partial<ConnectorTransportOptions> = {}): ConnectorTransport {
  return new ConnectorTransport({
    serverUrl: 'http://127.0.0.1:8787/base',
    WebSocketImpl: FakeWebSocket,
    heartbeatMs: 60_000,
    logger: { warn() {} },
    ...overrides,
  });
}

test('maps the Server URL and sends the device credential on reconnect', async () => {
  FakeWebSocket.instances = [];
  const client = transport({ getDeviceToken: () => 'device-secret' });
  await client.start();
  const ws = FakeWebSocket.instances[0];
  assert.ok(ws);
  assert.equal(ws.url, 'ws://127.0.0.1:8787/v1/connector/ws');
  assert.equal(ws.options.headers?.Authorization, 'Bearer device-secret');
  client.stop();
});

test('emits parsed server messages and sends versioned envelopes', async () => {
  FakeWebSocket.instances = [];
  const client = transport();
  const messages: unknown[] = [];
  client.on('message', (message: unknown) => messages.push(message));
  await client.start();
  const ws = FakeWebSocket.instances[0];
  assert.ok(ws);
  ws.open();
  client.send({ v: 1, type: 'pair.start', requestId: 'req-1' });
  assert.deepEqual(JSON.parse(ws.sent[0]!), { v: 1, type: 'pair.start', requestId: 'req-1' });
  ws.emit('message', Buffer.from('{"v":1,"type":"pair.challenge"}'));
  assert.deepEqual(messages, [{ v: 1, type: 'pair.challenge' }]);
  client.stop();
});

test('accepts ArrayBuffer WebSocket frames without assuming a length property', async () => {
  FakeWebSocket.instances = [];
  const client = transport();
  const messages: unknown[] = [];
  client.on('message', (message: unknown) => messages.push(message));
  await client.start();
  const ws = FakeWebSocket.instances[0];
  assert.ok(ws);
  const data = new TextEncoder().encode('{"v":1,"type":"pair.challenge"}').buffer;
  ws.emit('message', data);
  assert.deepEqual(messages, [{ v: 1, type: 'pair.challenge' }]);
  client.stop();
});

test('invalid JSON is isolated as a protocol error', async () => {
  FakeWebSocket.instances = [];
  const client = transport();
  let protocolError: (Error & { code?: string }) | undefined;
  client.on('protocolError', (error: Error & { code?: string }) => { protocolError = error; });
  await client.start();
  const ws = FakeWebSocket.instances[0];
  assert.ok(ws);
  ws.emit('message', Buffer.from('{'));
  assert.equal(protocolError?.code, 'invalid_json');
  client.stop();
});

test('offline sends fail fast instead of silently queuing commands', () => {
  const client = transport();
  assert.throws(() => client.send({ type: 'command' }), { code: 'connector_offline' });
});

test('stop/start during async token loading cannot resurrect an old connection', async () => {
  FakeWebSocket.instances = [];
  let release!: (token: string) => void;
  const token = new Promise<string>((resolve) => { release = resolve; });
  const client = transport({ getDeviceToken: () => token });
  const first = client.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  client.stop();
  const second = client.start();
  release('device-secret');
  await Promise.all([first, second]);
  assert.equal(FakeWebSocket.instances.length, 1);
  client.stop();
});

test('HTTPS Servers require WSS for the outbound connection', () => {
  assert.equal(
    connectorUrl('https://connect.example.com/root?ignored=true'),
    'wss://connect.example.com/v1/connector/ws',
  );
});
