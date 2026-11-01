import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, inject, name } from '../src/index.js';
import type { ConnectorApi } from '../src/index.js';
import type {
  HostContext,
  SessionController,
  SessionFollowFrame,
  WebRoute,
} from '../src/host-api.js';

type PluginService = ConnectorApi | WebRoute['handler'];
type EffectRegister = () => void | (() => void);

function fakeSessionController(): SessionController {
  return {
    async list() { return { items: [] }; },
    async create() { return { sessionId: 'unused' }; },
    async page() { return { records: [], hasMore: false }; },
    async prompt() { return { accepted: true }; },
    cancel() { return { accepted: true }; },
    async *follow(): AsyncGenerator<SessionFollowFrame, void, unknown> {},
  };
}

function isPluginService(value: unknown): value is PluginService {
  return typeof value === 'function' || (typeof value === 'object' && value !== null);
}

test('Host plugin loads without a Server and exposes only non-secret status', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-connect-plugin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  process.env.DSH_CONNECT_STATE_FILE = join(directory, 'connector.json');
  const services = new Map<string, PluginService>();
  const disposers: EffectRegister[] = [];
  const ctx: HostContext = {
    sessionController: fakeSessionController(),
    workspaceRegistry: {
      list: () => [{ id: 'ws-1', path: '/work/a', title: 'A', sessionIds: [], createdAt: 'now', updatedAt: 'now' }],
    },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    webServer: {
      match: () => ({}),
      register(route) { services.set(`rpc:${route.path}`, route.handler); return () => {}; },
    },
    provide(serviceName, service) {
      assert.ok(isPluginService(service));
      services.set(serviceName, service);
    },
    effect(register) { disposers.push(register); },
    logger: { warn() {} },
  };
  assert.equal(name, 'dsh-connect-connector');
  assert.deepEqual(inject, ['sessionController', 'workspaceRegistry', 'connection', 'webServer']);
  assert.doesNotThrow(() => apply(ctx));
  const api = services.get('dshConnectConnector');
  assert.ok(api && typeof api === 'object');
  const status = await api.status();
  assert.equal(status.connected, false);
  assert.equal(status.deviceId, null);
  assert.equal('deviceToken' in status, false);
  const workspace = api.listWorkspaces()[0];
  assert.ok(workspace);
  assert.equal(workspace.id, 'ws-1');
  assert.equal(typeof services.get('rpc:/dsh-connect'), 'function');
  api.disconnect();
  disposers.forEach((dispose) => dispose());
});

test('corrupt persisted state fails closed without blocking recovery APIs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-connect-plugin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'connector.json');
  await writeFile(file, '{not-json');
  process.env.DSH_CONNECT_STATE_FILE = file;
  const services = new Map<string, PluginService>();
  const ctx: HostContext = {
    sessionController: fakeSessionController(),
    workspaceRegistry: { list: () => [] },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    webServer: {
      match: () => ({}),
      register(route) { services.set(`rpc:${route.path}`, route.handler); return () => {}; },
    },
    provide(serviceName, service) {
      assert.ok(isPluginService(service));
      services.set(serviceName, service);
    },
    effect() {},
    logger: { warn() {} },
  };
  assert.doesNotThrow(() => apply(ctx));
  const api = services.get('dshConnectConnector');
  assert.ok(api && typeof api === 'object');
  const status = await api.status();
  assert.equal(status.deviceId, null);
  assert.equal(status.connected, false);
});
