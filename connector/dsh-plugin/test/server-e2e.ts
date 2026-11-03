import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import type { RawData } from 'ws';
import type {
  HostWorkspace,
  RuntimeHostContext,
  SessionCreateRequest,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionPageRequest,
  SessionPromptRequest,
} from '../src/host-api.js';
import type { UnknownRecord } from '../src/types.js';
import { isRecord } from '../src/types.js';
import { FileStateStore } from '../src/lib/file-state-store.js';
import { ConnectorRuntime } from '../src/lib/runtime.js';

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = resolve(pluginDir, '../..');
const serverDir = join(root, 'server');
const temp = await mkdtemp(join(tmpdir(), 'dsh-connect-e2e-'));
const port = await availablePort();
const serverUrl = `http://127.0.0.1:${port}`;
const token = 'e2e-bootstrap-token-that-is-not-for-production';
const promptRequestId = `prompt-e2e-${Date.now()}-${process.pid}`;
const createRequestId = `create-e2e-${Date.now()}-${process.pid}`;
const mobilePromptRequestId = `mobile-prompt-e2e-${Date.now()}-${process.pid}`;
const mobileCreateRequestId = `mobile-create-e2e-${Date.now()}-${process.pid}`;
const binary = join(temp, process.platform === 'win32' ? 'server.exe' : 'server');
let server: ChildProcess | null = null;
let runtime: ConnectorRuntime | null = null;
let pairedDeviceId: string | undefined;
const serverLog: string[] = [];

interface DevicesResponse {
  readonly devices: { readonly deviceId: string; readonly status: string }[];
}

interface SessionListResponse {
  readonly sessions: { readonly sessionId: string }[];
}

interface PromptResponse {
  readonly status: string;
  readonly requestId: string;
}

async function main(): Promise<void> {
  try {
    execFileSync('go', ['-C', serverDir, 'build', '-o', binary, './cmd/server'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        GOCACHE: join(root, '.tmp', 'go-build'),
        GOMODCACHE: join(root, '.tmp', 'go-mod'),
      },
    });
    server = spawn(binary, [], {
      env: {
        ...process.env,
        DSH_CONNECT_BOOTSTRAP_TOKEN: token,
        DSH_CONNECT_LISTEN_ADDR: `127.0.0.1:${port}`,
        DSH_CONNECT_SERVER_URL: serverUrl,
        DSH_CONNECT_ATTACHMENT_DIR: join(temp, 'attachments'),
      },
    });
    server.stdout?.on('data', (data: Buffer) => serverLog.push(data.toString()));
    server.stderr?.on('data', (data: Buffer) => serverLog.push(data.toString()));
    const pairing = await waitForServer();
    const workspaceRoot = join(temp, 'workspace');
    await mkdir(workspaceRoot, { recursive: true });
    const attachmentPath = join(workspaceRoot, 'diagram.png');
    const attachmentBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    await writeFile(attachmentPath, attachmentBytes);
    const host = createHost(workspaceRoot, attachmentPath, attachmentBytes);
    const store = new FileStateStore(join(temp, 'connector-state.json'));
    const persist = store.setMany.bind(store);
    store.setMany = async (values) => {
      if (values.workspaces) await delay(200);
      return persist(values);
    };
    runtime = new ConnectorRuntime({
      ctx: host.ctx,
      store,
      serverUrl,
      connectorVersion: '0.1.0-e2e',
      logger: { warn(...args: unknown[]) { serverLog.push(`connector: ${args.join(' ')}\n`); } },
    });

    const challenge = await runtime.pairing.startPairing({ pairingCode: pairing.code, deviceName: 'E2E Desktop' });
    assert.equal(challenge.deviceId.startsWith('dev_'), true);
    // Polling authenticated-only capabilities must not send a pre-pairing
    // control request that disconnects the pending challenge.
    await assert.rejects(runtime.mobileAccessList(), { code: 'not_paired' });
    assert.equal(runtime.transport.connected, true);
    assert.equal(runtime.pairing.state, 'waiting_desktop_authorization');
    assert.equal(runtime.pairing.publicChallenge()?.deviceId, challenge.deviceId);
    const authorizing = runtime.authorize({
      workspaces: [{ id: 'ws-1', name: 'E2E Workspace', path: workspaceRoot }],
      scopes: ['read', 'prompt', 'cancel'],
    });
    const deviceId = challenge.deviceId;
    pairedDeviceId = deviceId;
    let listed: SessionListResponse | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = await request<DevicesResponse>('/v1/devices');
      if (current.devices.find((device) => device.deviceId === deviceId)?.status === 'online') {
        // Issue a command before authorize() finishes its delayed grant write.
        listed = await request<SessionListResponse>(`/v1/sessions?deviceId=${deviceId}`);
        break;
      }
      await delay(10);
    }
    await authorizing;
    assert.ok(listed, 'session.list must complete after pairing');
    assert.equal(listed.sessions[0]?.sessionId, 'existing-session');
    const devices = await request<DevicesResponse>('/v1/devices');
    assert.equal(devices.devices.find((device) => device.deviceId === deviceId)?.status, 'online');
    const createBody = { requestId: createRequestId, deviceId, workspaceId: 'ws-1' };
    const created = await request<{ readonly sessionId: string }>('/v1/sessions', {
      method: 'POST', body: createBody,
    });
    const sessionId = created.sessionId;
    assert.equal(sessionId, 'created-session');
    const createReplay = await request<{ readonly sessionId: string }>('/v1/sessions', {
      method: 'POST', body: createBody,
    });
    assert.deepEqual(createReplay, created);
    assert.equal(host.createCalls, 1, 'duplicate create requestId must not reach Host twice');

    const events = new EventClient(`${serverUrl.replace('http:', 'ws:')}/v1/events/ws?deviceId=${deviceId}&sessionId=${sessionId}&cursor=0`, token);
    await events.open();
    await events.waitFor((message) => message.kind === 'session.snapshot');

    const promptBody = {
      requestId: promptRequestId, deviceId, mode: 'queue',
      content: [{ type: 'text', text: 'Run the P0 integration test' }], clientTimeZone: 'Asia/Shanghai',
    };
    const accepted = await request<PromptResponse>(`/v1/sessions/${sessionId}/prompt`, { method: 'POST', body: promptBody });
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.requestId, promptRequestId);
    await events.waitFor((message) => message.kind === 'assistant.stream');
    await events.waitFor((message) => message.kind === 'session.event' && message.seq === 3);

    const replay = await request<PromptResponse>(`/v1/sessions/${sessionId}/prompt`, { method: 'POST', body: promptBody });
    assert.deepEqual(replay, accepted);
    assert.equal(host.promptCalls, 1, 'duplicate requestId must not reach Host twice');

    const page = await request<{ readonly items: { readonly event: { readonly sessionId: string } }[] }>(`/v1/sessions/${sessionId}/page?deviceId=${deviceId}&limit=50`);
    assert.equal(page.items[0]?.event.sessionId, sessionId);
    const cancelled = await request<{ readonly accepted: boolean }>(`/v1/sessions/${sessionId}/cancel`, {
      method: 'POST', body: { requestId: 'cancel-e2e-1', deviceId },
    });
    assert.equal(cancelled.accepted, true);
    events.close();
    await waitFor(() => host.followAborted(sessionId), 'Host unfollow after App disconnect');

    // The persisted device credential must authenticate a fresh outbound WSS.
    runtime.stop();
    await delay(150);
    await runtime.start();
    await waitFor(() => runtime?.transport.connected === true, 'Connector reconnect');
    const relisted = await request<SessionListResponse>(`/v1/sessions?deviceId=${deviceId}`);
    assert.equal(relisted.sessions.length, 2);

    // Mobile access: pairing alone grants nothing; the desktop Connector must
    // approve the phone's workspace request before session data is readable.
    const users = await request<{ readonly users: readonly { readonly id: string; readonly role: string }[] }>('/v1/admin/users');
    const owner = users.users.find((user) => user.role === 'owner');
    assert.ok(owner, 'e2e owner account');
    const mobileCode = await request<{ readonly code: string }>('/v1/admin/mobile/pairing-codes', {
      method: 'POST', body: { userId: owner.id },
    });
    const phone = await mobileRequest<{
      readonly mobileDeviceId: string;
      readonly accessToken: string;
      readonly refreshToken: string;
    }>('/v1/mobile/pair', '', {
      method: 'POST',
      body: { code: mobileCode.code, deviceName: 'E2E iPhone', platform: 'ios', appVersion: '0.1.0' },
    });
    const accessBefore = await mobileRequest<{ readonly desktops: readonly { readonly grant?: unknown }[] }>('/v1/mobile/access', phone.accessToken);
    assert.equal(accessBefore.desktops[0]?.grant, undefined);
    const accessRequest = await mobileRequest<{ readonly status: string; readonly grantId: string }>(
      '/v1/mobile/access/requests', phone.accessToken,
      { method: 'POST', body: { deviceId, workspaces: ['ws-1'], scopes: ['read', 'prompt'] } },
    );
    assert.equal(accessRequest.status, 'pending');
    const pendingAccess = await runtime.mobileAccessList();
    assert.equal(pendingAccess.grants[0]?.status, 'pending');
    assert.equal(pendingAccess.grants[0]?.mobileDeviceName, 'E2E iPhone');
    const decision = await runtime.mobileAccessDecide({
      mobileDeviceId: phone.mobileDeviceId,
      action: 'allow',
      workspaces: ['ws-1'],
      scopes: ['read', 'prompt'],
    }) as { readonly status: string };
    assert.equal(decision.status, 'active');
    const mobileCreateBody = { requestId: mobileCreateRequestId, deviceId, workspaceId: 'ws-1' };
    const mobileCreated = await mobileRequest<{ readonly sessionId: string; readonly workspaceId: string }>(
      '/v1/mobile/sessions', phone.accessToken, { method: 'POST', body: mobileCreateBody },
    );
    assert.equal(mobileCreated.sessionId, 'mobile-created-session-1');
    assert.equal(mobileCreated.workspaceId, 'ws-1');
    const mobileCreateReplay = await mobileRequest<{ readonly sessionId: string; readonly workspaceId: string }>(
      '/v1/mobile/sessions', phone.accessToken, { method: 'POST', body: mobileCreateBody },
    );
    assert.deepEqual(mobileCreateReplay, mobileCreated);
    assert.equal(host.createCalls, 2, 'mobile create replay must not reach Host twice');
    const mobileWorkspaces = await mobileRequest<{ readonly workspaces: readonly { readonly workspace: { readonly id: string } }[] }>(
      '/v1/mobile/workspaces', phone.accessToken,
    );
    assert.equal(mobileWorkspaces.workspaces[0]?.workspace.id, 'ws-1');
    const mobileSessions = await mobileRequest<{ readonly sessions: readonly { readonly sessionId: string }[] }>(
      '/v1/mobile/sessions', phone.accessToken,
    );
    assert.ok(mobileSessions.sessions.some((session) => session.sessionId === 'existing-session'));
    assert.ok(mobileSessions.sessions.some((session) => session.sessionId === mobileCreated.sessionId));
    const mobileTranscript = await mobileRequest<{
      readonly messages: readonly {
        readonly role: string;
        readonly attachments?: readonly { readonly attachmentId: string; readonly state: string; readonly name: string }[];
      }[];
      readonly turnEndSeq?: number;
    }>(
      `/v1/mobile/sessions/existing-session/messages?deviceId=${deviceId}&workspaceId=ws-1`, phone.accessToken,
    );
    assert.deepEqual(mobileTranscript.messages.map((message) => message.role), ['user', 'assistant']);
    assert.equal(mobileTranscript.turnEndSeq, 5);
    const declared = mobileTranscript.messages[1]?.attachments?.[0];
    assert.equal(declared?.name, 'diagram.png');
    assert.equal(declared?.state, 'known');
    assert.ok(declared, 'present file must be projected into the mobile transcript');

    const mobileEvents = new EventClient(
      `${serverUrl.replace('http:', 'ws:')}/v1/mobile/events/ws?deviceId=${deviceId}&workspaceId=ws-1&sessionId=existing-session`,
      phone.accessToken,
    );
    await mobileEvents.open();
    let downloaded: Uint8Array | undefined;
    for (let attempt = 0; attempt < 100 && !downloaded; attempt += 1) {
      const response = await fetch(`${serverUrl}/v1/mobile/attachments/${declared.attachmentId}`, {
        headers: { Authorization: `Bearer ${phone.accessToken}` },
      });
      const payload = new Uint8Array(await response.arrayBuffer());
      if (response.status === 200) {
        downloaded = payload;
        break;
      }
      if (response.status !== 202) throw new Error(`attachment download failed: ${response.status} ${new TextDecoder().decode(payload)}`);
      await delay(50);
    }
    if (!downloaded) {
      const debugTranscript = await mobileRequest<{
        readonly messages: readonly { readonly attachments?: readonly unknown[] }[];
      }>(`/v1/mobile/sessions/existing-session/messages?deviceId=${deviceId}&workspaceId=ws-1`, phone.accessToken);
      serverLog.push(`attachment did not become ready; reads=${host.attachmentReads}; state=${JSON.stringify(debugTranscript.messages[1]?.attachments)}\n`);
    }
    assert.deepEqual(downloaded, attachmentBytes, 'mobile must receive the exact Host-read bytes');
    assert.equal(host.attachmentReads, 1, 'concurrent pending downloads must share one Host read');
    await mobileEvents.waitFor((message) => message.kind === 'attachment.ready');
    mobileEvents.close();
    const mobilePrompt = await mobileRequest<{ readonly status: string }>(
      `/v1/mobile/sessions/${mobileCreated.sessionId}/prompt`, phone.accessToken,
      {
        method: 'POST',
        body: {
          requestId: mobilePromptRequestId, deviceId, workspaceId: 'ws-1', mode: 'queue', text: 'mobile follow-up',
        },
      },
    );
    assert.equal(mobilePrompt.status, 'accepted');
    await mobileRequest('/v1/mobile/auth/logout', phone.accessToken, { method: 'POST' });

    runtime.stop();
    runtime = null;
    await delay(200);
    await assert.rejects(
      request(`/v1/sessions?deviceId=${deviceId}`),
      /device_offline/,
    );

    console.log(JSON.stringify({
      ok: true,
      coverage: [
        'pair.start/challenge/authorize/complete',
        'session.list/create/page/prompt/follow/unfollow/cancel',
        'immediate command after pair.complete',
        'durable events and assistant stream',
        'Host unfollow after App disconnect',
        'create + prompt idempotency',
        'device token reconnect',
        'mobile access request + desktop approval',
        'mobile workspaces/sessions/create/transcript/prompt',
        'present attachment → Host bytes → upload → mobile download + attachment.ready',
        'offline fast failure',
      ],
      host: 'controlled Host simulation; real DSH smoke test remains separate',
    }, null, 2));
  } catch (error) {
    console.error(serverLog.join(''));
    throw error;
  } finally {
    runtime?.stop();
    if (pairedDeviceId) {
      // The E2E may run against a developer database. Remove only the device it
      // created so repeated runs cannot pollute the device list.
      try {
        await request(`/v1/admin/devices/${pairedDeviceId}`, { method: 'DELETE' });
      } catch (error) {
        serverLog.push(`e2e cleanup failed: ${String(error)}\n`);
      }
    }
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([new Promise((resolveExit) => server?.once('exit', resolveExit)), delay(3_000)]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    await rm(temp, { recursive: true, force: true });
  }
}

async function mobileRequest<T = unknown>(
  path: string,
  accessToken: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(value) && isRecord(value.error) ? value.error : undefined;
    throw new Error(`${response.status} ${String(error?.code)}: ${String(error?.message)}`);
  }
  return value as T;
}

async function request<T = unknown>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = isRecord(value) && isRecord(value.error) ? value.error : undefined;
    throw new Error(`${response.status} ${String(error?.code)}: ${String(error?.message)}`);
  }
  return value as T;
}

async function waitForServer(): Promise<{ readonly code: string }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!server) throw new Error('Server was not started');
    if (server.exitCode !== null) throw new Error(`Server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`${serverUrl}/v1/pairing/desktop-codes`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) return await response.json() as { readonly code: string };
    } catch {
      // The listener may not be ready yet.
    }
    await delay(100);
  }
  throw new Error('Server did not become ready');
}

interface HostFixture {
  createCalls: number;
  promptCalls: number;
  attachmentReads: number;
  followAborted(sessionId: string): boolean;
  readonly ctx: RuntimeHostContext;
}

function createHost(workspaceRoot: string, attachmentPath: string, attachmentBytes: Uint8Array): HostFixture {
  const workspaces: HostWorkspace[] = [{
    id: 'ws-1', path: workspaceRoot, title: 'E2E Workspace', sessionIds: ['existing-session'],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }];
  const follows = new Map<string, FollowQueue>();
  const host: HostFixture = {
    createCalls: 0,
    promptCalls: 0,
    attachmentReads: 0,
    followAborted: (sessionId) => follows.get(sessionId)?.signal.aborted ?? false,
    ctx: {
      workspaceRegistry: { list: () => workspaces },
      workspaceFiles: {
        async readBytes(scope, path, options, signal) {
          host.attachmentReads += 1;
          try {
            assert.deepEqual(scope, { sessionId: 'existing-session', workspaceRoot });
            assert.equal(path, await realpath(attachmentPath));
            assert.equal(signal.aborted, false);
            // Match DSH rc.5: one ranged window is 2 MiB, while a complete file
            // may be 32 MiB. This catches an invalid 20 MiB window request.
            if (options.range && (options.range.length ?? 2_097_152) > 2_097_152) {
              throw Object.assign(new Error('window too large'), { code: 'workspace-file/too-large' });
            }
            if (!options.range && attachmentBytes.byteLength > 33_554_432) {
              throw Object.assign(new Error('file too large'), { code: 'workspace-file/too-large' });
            }
            return { data: attachmentBytes, offset: 0, eof: true, bytes: attachmentBytes.byteLength };
          } catch (error) {
            serverLog.push(`attachment Host read failed: ${String(error)}\n`);
            throw error;
          }
        },
        async stat(_scope, path) {
          return { path, bytes: attachmentBytes.byteLength };
        },
      },
      sessionController: {
        async list() {
          return {
            items: workspaces.flatMap((workspace) => workspace.sessionIds.map((sessionId) => ({
              sessionId, updatedAt: Date.now(), running: false, blank: false, agentAvailable: true,
              projections: { kind: 'sequenced', asOfSeq: 1, values: { title: sessionId } },
            }))),
          };
        },
        async create({ workspaceId }: SessionCreateRequest) {
          assert.equal(workspaceId, 'ws-1');
          host.createCalls += 1;
          const workspace = workspaces[0];
          assert.ok(workspace);
          const sessionId = host.createCalls === 1 ? 'created-session' : `mobile-created-session-${host.createCalls - 1}`;
          (workspace.sessionIds as string[]).push(sessionId);
          return { sessionId };
        },
        async page(_request: SessionPageRequest) {
          return {
            records: [
              { type: 'event' as const, event: { type: 'user/message', seq: 1, time: 1_000, data: { id: 'e2e-user', role: 'user', content: [{ type: 'text', text: 'existing question' }] } } },
              { type: 'event' as const, event: { type: 'turn/start', seq: 2, time: 1_500, data: { turn: 1 } } },
              { type: 'event' as const, event: { type: 'deliverables/presented', seq: 3, time: 1_750, data: { turn: 1, callId: 'present-1', files: [{ path: attachmentPath, description: 'E2E diagram' }] } } },
              { type: 'event' as const, event: { type: 'assistant/message', seq: 4, time: 2_000, data: { message: { id: 'e2e-assistant', content: [{ type: 'text', text: 'existing answer' }] } } } },
              { type: 'event' as const, event: { type: 'turn/end', seq: 5, time: 3_000, data: { reason: 'completed' } } },
            ],
            hasMore: false,
          };
        },
        async prompt(request: SessionPromptRequest) {
          host.promptCalls += 1;
          if (request.requestId === promptRequestId) {
            assert.equal(request.requestId, promptRequestId);
            const follow = follows.get(request.sessionId);
            assert.ok(follow, 'prompt requires an active follow fixture');
            follow.push({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 1, index: 0, chunk: { type: 'text-delta', text: 'working' } } });
            follow.push({ type: 'event', event: { type: 'user/message', seq: 2, time: 2_000, data: { source: { rpcId: request.requestId } } } });
            follow.push({ type: 'event', event: { type: 'turn/end', seq: 3, time: 3_000, data: { reason: 'completed' } } });
          }
          return { accepted: true };
        },
        cancel() { return { accepted: true }; },
        follow(request: SessionFollowRequest, signal: AbortSignal) {
          assert.equal(request.address.kind, 'session');
          const follow = new FollowQueue(request.address.sessionId, signal);
          follows.set(request.address.sessionId, follow);
          return follow.iterable();
        },
      },
    },
  };
  return host;
}

class FollowQueue {
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly #queue: (SessionFollowFrame | null)[] = [];
  #waiter: ((frame: SessionFollowFrame | null) => void) | null = null;

  constructor(sessionId: string, signal: AbortSignal) {
    this.sessionId = sessionId;
    this.signal = signal;
    signal.addEventListener('abort', () => this.push(null), { once: true });
  }

  push(frame: SessionFollowFrame | null): void {
    if (this.#waiter) {
      this.#waiter(frame);
      this.#waiter = null;
    } else this.#queue.push(frame);
  }

  async *iterable(): AsyncGenerator<SessionFollowFrame> {
    yield {
      type: 'snapshot',
      header: { id: this.sessionId, createdAt: 500, version: 1, isSeeded: false },
      cursor: 1, records: [], hasMore: false, projections: { asOfSeq: 1, values: {} },
    };
    while (!this.signal.aborted) {
      const frame = this.#queue.length
        ? this.#queue.shift()
        : await new Promise<SessionFollowFrame | null>((resolveFrame) => { this.#waiter = resolveFrame; });
      if (!frame) return;
      yield frame;
    }
  }
}

class EventClient {
  readonly messages: UnknownRecord[] = [];
  readonly #ws: WebSocket;

  constructor(url: string, authToken: string) {
    this.#ws = new WebSocket(url, { headers: { Authorization: `Bearer ${authToken}` } });
    this.#ws.on('message', (data: RawData) => {
      const value: unknown = JSON.parse(data.toString());
      if (isRecord(value)) this.messages.push(value);
    });
  }

  open(): Promise<void> {
    return new Promise((resolveOpen, reject) => {
      this.#ws.once('open', resolveOpen);
      this.#ws.once('error', reject);
    });
  }

  waitFor(predicate: (message: UnknownRecord) => boolean): Promise<void> {
    return waitFor(() => this.messages.some(predicate), 'expected WebSocket event');
  }

  close(): void {
    this.#ws.close();
  }
}

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address() as AddressInfo | string | null;
      if (!address || typeof address === 'string') {
        listener.close();
        reject(new Error('TCP listener did not expose a port'));
        return;
      }
      const { port: available } = address;
      listener.close(() => resolvePort(available));
    });
  });
}

await main();
