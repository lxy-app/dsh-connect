import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { PairingController } from '../src/lib/pairing.js';
import type { PairingStore, PairingTransport } from '../src/lib/pairing.js';
import type { ConnectorScope, TransportEnvelope, WorkspaceGrants } from '../src/types.js';

class FakeTransport extends EventEmitter implements PairingTransport {
  readonly connected = true;
  readonly sent: TransportEnvelope[] = [];

  send(message: TransportEnvelope): void {
    this.sent.push(message);
  }

  async start(): Promise<void> {}
}

class MemoryStore implements PairingStore {
  readonly values = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.values.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    if (value === null || value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }
}

const readOnlyScopes: readonly ConnectorScope[] = ['read'];

function setup() {
  const transport = new FakeTransport();
  const store = new MemoryStore();
  const pairing = new PairingController({ transport, store, connectorVersion: '0.1.0' });
  return { transport, store, pairing };
}

test('pairing requires explicit desktop authorization before a credential is stored', async () => {
  const { transport, store, pairing } = setup();
  const starting = pairing.startPairing({ pairingCode: 'DC-TEST', deviceName: 'MacBook' });
  assert.equal(pairing.state, 'waiting_connector');
  assert.equal(transport.sent[0]?.type, 'pair.start');
  assert.equal(store.values.has('deviceToken'), false);

  transport.emit('message', {
    type: 'pair.challenge',
    requestId: transport.sent[0]?.requestId,
    deviceId: 'dev-1',
    fingerprint: 'AA:BB:CC',
    pairingToken: 'pairing-secret',
    expiresAt: '2026-10-27T16:00:00Z',
  });
  assert.deepEqual(await starting, {
    deviceId: 'dev-1',
    fingerprint: 'AA:BB:CC',
    expiresAt: '2026-10-27T16:00:00Z',
  });
  assert.equal(pairing.state, 'waiting_desktop_authorization');
  assert.equal(store.values.has('deviceToken'), false);

  const grants: WorkspaceGrants = {
    workspaces: [{ id: 'ws-1', name: 'Project', path: '/work/project' }],
    scopes: ['read', 'prompt', 'cancel'],
  };
  const authorizing = pairing.authorize(grants);
  assert.equal(transport.sent[1]?.type, 'pair.authorize');
  assert.equal(transport.sent[1]?.pairingToken, 'pairing-secret');
  transport.emit('message', {
    type: 'pair.complete',
    requestId: transport.sent[1]?.requestId,
    deviceId: 'dev-1',
    deviceToken: 'device-secret',
    fingerprint: 'AA:BB:CC',
  });
  await authorizing;
  assert.equal(store.values.get('deviceToken'), 'device-secret');
  assert.equal(pairing.state, 'connected');
});

test('authorization is impossible before the Server challenge', async () => {
  const { pairing } = setup();
  await assert.rejects(
    pairing.authorize({ workspaces: [{ id: 'ws-1' }], scopes: readOnlyScopes }),
    { code: 'invalid_pairing_state' },
  );
});

test('an empty workspace grant is rejected on the desktop', async () => {
  const { transport, pairing } = setup();
  const starting = pairing.startPairing({ pairingCode: 'DC-TEST', deviceName: 'MacBook' });
  transport.emit('message', {
    type: 'pair.challenge', requestId: transport.sent[0]?.requestId, deviceId: 'dev-1', fingerprint: 'AA:BB:CC', pairingToken: 'secret',
  });
  await starting;
  await assert.rejects(pairing.authorize({ workspaces: [], scopes: readOnlyScopes }), {
    code: 'invalid_workspace_grant',
  });
});

test('a pending challenge is invalidated when its Connector connection drops', async () => {
  const { transport, pairing } = setup();
  const starting = pairing.startPairing({ pairingCode: 'DC-TEST', deviceName: 'MacBook' });
  transport.emit('message', {
    type: 'pair.challenge', requestId: transport.sent[0]?.requestId, deviceId: 'dev-1', fingerprint: 'AA:BB:CC', pairingToken: 'secret',
  });
  await starting;
  transport.emit('disconnected', { code: 1006 });
  assert.equal(pairing.challenge, null);
  assert.equal(pairing.publicChallenge(), null);
  assert.equal(pairing.state, 'disconnected');
  await assert.rejects(
    pairing.authorize({ workspaces: [{ id: 'ws-1' }], scopes: readOnlyScopes }),
    { code: 'invalid_pairing_state' },
  );
});

test('Server pairing failures do not issue a device identity', async () => {
  const { transport, store, pairing } = setup();
  const starting = pairing.startPairing({ pairingCode: 'DC-USED', deviceName: 'MacBook' });
  transport.emit('message', { type: 'pair.error', requestId: transport.sent[0]?.requestId, error: { code: 'code_used', message: 'Code used' } });
  await assert.rejects(starting, { code: 'code_used' });
  assert.equal(pairing.state, 'pairing_failed');
  assert.equal(store.values.has('deviceToken'), false);
});

test('a delayed challenge write cannot resurrect after disconnect', async () => {
  const { transport, store, pairing } = setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const set = store.set.bind(store);
  store.set = async (key: string, value: unknown): Promise<void> => {
    if (key === 'pendingPairing' && value) await gate;
    return set(key, value);
  };
  const starting = pairing.startPairing({ pairingCode: 'DC-TEST', deviceName: 'MacBook' });
  transport.emit('message', {
    type: 'pair.challenge', requestId: transport.sent[0]?.requestId, deviceId: 'dev-1', fingerprint: 'AA:BB:CC', pairingToken: 'secret',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  transport.emit('disconnected', { code: 1006 });
  await assert.rejects(starting, { code: 'pairing_disconnected' });
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pairing.state, 'disconnected');
  assert.equal(pairing.challenge, null);
  assert.equal(pairing.publicChallenge(), null);
});

test('authorization ignores a completion belonging to another request', async () => {
  const { transport, store, pairing } = setup();
  const starting = pairing.startPairing({ pairingCode: 'DC-TEST', deviceName: 'MacBook' });
  transport.emit('message', {
    type: 'pair.challenge', requestId: transport.sent[0]?.requestId, deviceId: 'dev-1', fingerprint: 'AA:BB:CC', pairingToken: 'secret',
  });
  await starting;
  const authorizing = pairing.authorize({ workspaces: [{ id: 'ws-1' }], scopes: readOnlyScopes });
  transport.emit('message', {
    type: 'pair.complete', requestId: 'unrelated-request', deviceId: 'dev-1', deviceToken: 'wrong-secret', fingerprint: 'AA:BB:CC',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pairing.state, 'waiting_desktop_authorization');
  assert.equal(store.values.has('deviceToken'), false);
  transport.emit('message', {
    type: 'pair.complete', requestId: transport.sent[1]?.requestId, deviceId: 'dev-1', deviceToken: 'device-secret', fingerprint: 'AA:BB:CC',
  });
  await authorizing;
  assert.equal(store.values.get('deviceToken'), 'device-secret');
});

test('authorization times out and a late completion cannot persist credentials', async () => {
  const transport = new FakeTransport();
  const store = new MemoryStore();
  const pairing = new PairingController({
    transport, store, connectorVersion: '0.1.0', responseTimeoutMs: 20,
  });
  const starting = pairing.startPairing({ pairingCode: 'DC-TEST', deviceName: 'MacBook' });
  transport.emit('message', {
    type: 'pair.challenge', requestId: transport.sent[0]?.requestId, deviceId: 'dev-1', fingerprint: 'AA:BB:CC', pairingToken: 'secret',
  });
  await starting;
  const authorizing = pairing.authorize({ workspaces: [{ id: 'ws-1' }], scopes: readOnlyScopes });
  await assert.rejects(authorizing, { code: 'pairing_response_timeout' });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pairing.state, 'pairing_failed');
  assert.equal(pairing.publicChallenge(), null);
  assert.equal(store.values.has('pendingPairing'), false);
  transport.emit('message', {
    type: 'pair.complete', requestId: transport.sent[1]?.requestId, deviceId: 'dev-1', deviceToken: 'late-secret', fingerprint: 'AA:BB:CC',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(store.values.has('deviceToken'), false);
  assert.equal(pairing.state, 'pairing_failed');
});
