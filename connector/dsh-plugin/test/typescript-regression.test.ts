import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStateStore } from '../src/lib/file-state-store.js';
import { PairingController } from '../src/lib/pairing.js';
import type { TransportEnvelope } from '../src/types.js';

class MemoryPairingTransport extends EventEmitter {
  readonly connected = true;
  readonly sent: TransportEnvelope[] = [];

  send(message: TransportEnvelope): void {
    this.sent.push(message);
  }

  async start(): Promise<void> {}
}

class MemoryPairingStore {
  readonly values = new Map<string, unknown>();

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async setMany(values: Readonly<Record<string, unknown>>): Promise<void> {
    for (const [key, value] of Object.entries(values)) this.values.set(key, value);
  }
}

test('an unsolicited pair.complete cannot replace the device identity', async () => {
  const transport = new MemoryPairingTransport();
  const store = new MemoryPairingStore();
  const pairing = new PairingController({ transport, store, connectorVersion: '0.1.4' });

  transport.emit('message', {
    type: 'pair.complete',
    deviceId: 'attacker-controlled-device',
    deviceToken: 'attacker-controlled-token',
    fingerprint: 'AA:BB:CC',
  });
  await new Promise(setImmediate);

  assert.equal(pairing.state, 'disconnected');
  assert.equal(store.values.has('deviceId'), false);
  assert.equal(store.values.has('deviceToken'), false);
});

test('valid non-object JSON state fails closed and remains recoverable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-connect-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'connector.json');
  await writeFile(file, 'null', { mode: 0o600 });
  const store = new FileStateStore(file);

  assert.equal(await store.get('deviceId'), undefined);
  await store.set('deviceId', 'dev-recovered');
  assert.deepEqual(await store.all(), { deviceId: 'dev-recovered' });
});
