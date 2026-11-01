import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStateStore } from '../src/lib/file-state-store.js';

interface PersistedState {
  readonly deviceId?: string;
  readonly deviceToken?: string;
  readonly fingerprint?: string;
  readonly workspace?: string;
}

test('state survives reload and the file is owner-only', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-connect-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'nested', 'connector.json');
  const store = new FileStateStore(file);
  await store.set('deviceId', 'dev-1');
  await store.set('deviceToken', 'secret');
  assert.equal(await new FileStateStore(file).get('deviceId'), 'dev-1');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('overlapping store instances in one Host do not lose updates', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-connect-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'connector.json');
  const first = new FileStateStore(file);
  const second = new FileStateStore(file);
  await Promise.all([
    first.set('deviceId', 'dev-1'),
    second.set('deviceToken', 'secret'),
  ]);
  const state = await first.all();
  assert.equal(state.deviceId, 'dev-1');
  assert.equal(state.deviceToken, 'secret');
});

test('concurrent writes are serialized without lost updates', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-connect-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'connector.json');
  const store = new FileStateStore(file);
  await Promise.all([
    store.set('deviceId', 'dev-1'),
    store.set('fingerprint', 'AA:BB:CC'),
    store.set('workspace', 'ws-1'),
  ]);
  const saved = JSON.parse(await readFile(file, 'utf8')) as PersistedState;
  assert.deepEqual(saved, { deviceId: 'dev-1', fingerprint: 'AA:BB:CC', workspace: 'ws-1' });
});
