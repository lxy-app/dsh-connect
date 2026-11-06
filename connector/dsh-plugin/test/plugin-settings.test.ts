import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { apply } from '../src/index.js';
import type { ConnectorApi } from '../src/index.js';
import type { HostContext, SessionController, SessionFollowFrame } from '../src/host-api.js';

type EffectRegister = () => void | (() => void);

function fakeSessionController(): SessionController {
  return {
    async list() { return { items: [] }; },
    async create() { return { sessionId: 'unused' }; },
    async events() { return { records: [], hasMore: false }; },
    async prompt() { return { accepted: true }; },
    cancel() { return { accepted: true }; },
    async *follow(): AsyncGenerator<SessionFollowFrame, void, unknown> {},
  };
}

async function setup(t: TestContext, initialState?: Record<string, unknown>, environmentUrl?: string): Promise<ConnectorApi> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-connect-settings-'));
  const file = join(directory, 'connector.json');
  if (initialState) await writeFile(file, JSON.stringify(initialState));
  const previous = {
    state: process.env.DSH_CONNECT_STATE_FILE,
    url: process.env.DSH_CONNECT_URL,
    serverUrl: process.env.DSH_CONNECT_SERVER_URL,
  };
  process.env.DSH_CONNECT_STATE_FILE = file;
  if (environmentUrl) process.env.DSH_CONNECT_URL = environmentUrl;
  else delete process.env.DSH_CONNECT_URL;
  delete process.env.DSH_CONNECT_SERVER_URL;
  t.after(async () => {
    for (const [key, value] of Object.entries({ DSH_CONNECT_STATE_FILE: previous.state, DSH_CONNECT_URL: previous.url, DSH_CONNECT_SERVER_URL: previous.serverUrl })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  let api: ConnectorApi | undefined;
  const disposers: EffectRegister[] = [];
  const ctx: HostContext = {
    sessionController: fakeSessionController(),
    workspaceRegistry: { list: () => [] },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    webServer: { register: () => () => {} },
    provide(name, service) { if (name === 'dshConnectConnector') api = service as ConnectorApi; },
    effect(register) { disposers.push(register); },
    logger: { warn() {} },
  };
  apply(ctx);
  t.after(() => disposers.forEach((register) => {
    const dispose = register();
    if (dispose) dispose();
  }));
  assert.ok(api);
  return api;
}

test('saves validated UI settings and preserves them across status reads', async (t) => {
  const api = await setup(t);
  assert.equal((await api.status()).configSource, 'default');
  const status = await api.updateSettings({ serverUrl: 'http://127.0.0.1:8787/', deviceName: '  My Mac  ' });
  assert.equal(status.serverUrl, 'http://127.0.0.1:8787');
  assert.equal(status.deviceName, 'My Mac');
  assert.equal(status.configSource, 'ui');
  assert.equal((await api.status()).serverUrl, 'http://127.0.0.1:8787');
  await assert.rejects(
    api.updateSettings({ serverUrl: 'https://example.com/base', deviceName: 'My Mac' }),
    (error: unknown) => (error as { code?: unknown }).code === 'invalid_server_url',
  );
  assert.equal((await api.status()).serverUrl, 'http://127.0.0.1:8787');
});

test('uses an environment URL only until the user saves UI settings', async (t) => {
  const api = await setup(t, undefined, 'http://127.0.0.1:8787');
  const initial = await api.status();
  assert.equal(initial.serverUrl, 'http://127.0.0.1:8787');
  assert.equal(initial.configSource, 'environment');
  const saved = await api.updateSettings({ serverUrl: 'http://127.0.0.1:8787', deviceName: 'My Mac' });
  assert.equal(saved.configSource, 'ui');
});

test('requires confirmation before changing a paired Server and clears scoped credentials', async (t) => {
  const api = await setup(t, {
    serverUrl: 'http://127.0.0.1:8787',
    deviceName: 'My Mac',
    deviceId: 'dev-old',
    deviceToken: 'secret-old',
    fingerprint: 'fingerprint-old',
    workspaces: [{ id: 'ws-1' }],
    scopes: ['read'],
  });
  await assert.rejects(
    api.updateSettings({ serverUrl: 'https://example.com', deviceName: 'My Mac' }),
    (error: unknown) => (error as { code?: unknown }).code === 'server_change_requires_pairing',
  );
  assert.equal((await api.status()).deviceId, 'dev-old');
  const changed = await api.updateSettings({
    serverUrl: 'https://example.com', deviceName: 'My Mac', confirmServerChange: true,
  });
  assert.equal(changed.serverUrl, 'https://example.com');
  assert.equal(changed.deviceId, null);
  assert.equal(changed.fingerprint, null);
  assert.deepEqual(changed.workspaces, []);
  assert.deepEqual(changed.scopes, []);
  assert.equal('deviceToken' in changed, false);
});
