import assert from 'node:assert/strict';
import test from 'node:test';
import { HostSessionAdapter } from '../src/lib/host-session-adapter.js';
import { WorkspacePolicy } from '../src/lib/workspace-policy.js';
import type {
  SessionController,
  SessionCreateRequest,
  SessionFollowRequest,
  SessionListRequest,
  SessionPageRequest,
  SessionPromptRequest,
  SessionSummary,
  WorkspaceRegistry,
} from '../src/host-api.js';

const summaries: SessionSummary[] = [
  {
    sessionId: 's1', updatedAt: 1_000, running: true, blank: false, agentAvailable: true,
    projections: { kind: 'cached', asOfSeq: 99, values: { title: 'Authorized session' } },
  },
  { sessionId: 's2', updatedAt: 2_000, running: false, blank: false, agentAvailable: true },
];

interface FakeWorkspace {
  id: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

type PromptCall = ['prompt', SessionPromptRequest, AbortSignal];
type ControllerCall =
  | ['list', SessionListRequest, AbortSignal]
  | ['create', SessionCreateRequest]
  | ['page', SessionPageRequest, AbortSignal]
  | PromptCall
  | ['cancel', { readonly sessionId: string }]
  | ['follow', SessionFollowRequest, AbortSignal];

type EmittedEvent = Record<string, unknown>;

interface SetupOverrides {
  readonly controller?: Partial<SessionController>;
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function eventAt(emitted: readonly EmittedEvent[], index: number): EmittedEvent {
  const event = emitted[index];
  assert.ok(event);
  return event;
}

function setup(overrides: SetupOverrides = {}) {
  const emitted: EmittedEvent[] = [];
  const calls: ControllerCall[] = [];
  const controller: SessionController = {
    async list(request, signal) { calls.push(['list', request, signal]); return { items: summaries }; },
    async create(request) { calls.push(['create', request]); return { sessionId: 's3' }; },
    async page(request, signal) {
      calls.push(['page', request, signal]);
      return { records: [{ type: 'event', event: { type: 'turn/end', seq: 1, time: 1_000, data: {} } }], hasMore: false };
    },
    async prompt(request, signal) { calls.push(['prompt', request, signal]); return { accepted: true }; },
    cancel(request) { calls.push(['cancel', request]); return { accepted: true }; },
    follow(request, signal) {
      calls.push(['follow', request, signal]);
      return (async function* () {
        yield {
          type: 'snapshot', header: { id: 's1', createdAt: 500, version: 1, isSeeded: false },
          cursor: 1,
          records: [{ type: 'event', event: { type: 'session/created', seq: 1, time: 500, data: {} } }],
          hasMore: false, projections: { asOfSeq: 1, values: {} },
        };
        yield { type: 'event', event: { type: 'turn/end', seq: 2, time: 2_000, data: { status: 'done' } } };
        yield { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 1, index: 0, chunk: { type: 'text-delta', text: 'ok' } } };
      }());
    },
    ...overrides.controller,
  };
  const workspaces: [FakeWorkspace, FakeWorkspace] = [
    { id: 'ws-a', path: '/work/a', title: 'A', sessionIds: ['s1'], createdAt: 'now', updatedAt: 'now' },
    { id: 'ws-b', path: '/work/b', title: 'B', sessionIds: ['s2'], createdAt: 'now', updatedAt: 'now' },
  ];
  const workspaceRegistry: WorkspaceRegistry = {
    list: () => workspaces,
  };
  const policy = new WorkspacePolicy({
    workspaces: [{ id: 'ws-a', name: 'A', path: '/work/a' }],
    scopes: ['read', 'prompt', 'cancel'],
  });
  const adapter = new HostSessionAdapter({
    controller, workspaceRegistry, policy, deviceId: 'dev-1', emit: (event) => emitted.push(event),
    logger: { warn() {} },
  });
  return { adapter, emitted, calls, controller, workspaces };
}

test('list derives workspace ownership from workspaceRegistry and filters grants', async () => {
  const { adapter } = setup();
  const result = await adapter.list({}, { signal: new AbortController().signal });
  assert.equal(result.sessions.length, 1);
  assert.deepEqual(result.sessions[0], {
    id: 's1', sessionId: 's1', workspaceId: 'ws-a', title: 'Authorized session', status: 'running',
    updatedAt: '1970-01-01T00:00:01.000Z', agentAvailable: true, blank: false, formatStatus: 'current',
  });
});

test('prompt cannot use an allowed workspaceId to target another workspace session', async () => {
  const { adapter, calls } = setup();
  await assert.rejects(adapter.prompt({
    sessionId: 's2', workspaceId: 'ws-a', content: [{ type: 'text', text: 'run' }],
  }, { signal: new AbortController().signal, requestId: 'req-1' }), { code: 'workspace_forbidden' });
  assert.equal(calls.some(([method]) => method === 'prompt'), false);
});

test('prompt preserves DSH request semantics and AbortSignal', async () => {
  const { adapter, calls } = setup();
  const signal = new AbortController().signal;
  assert.deepEqual(await adapter.prompt({
    sessionId: 's1', workspaceId: 'ws-a', mode: 'steer', content: [{ type: 'text', text: 'Continue' }],
  }, { signal, requestId: 'req-2' }), {
    accepted: true, sessionId: 's1', requestId: 'req-2', status: 'accepted',
  });
  const prompt = calls.find((call): call is PromptCall => call[0] === 'prompt');
  assert.ok(prompt);
  assert.equal(prompt[1].requestId, 'req-2');
  assert.equal(prompt[1].mode, 'steer');
  assert.equal(prompt[2], signal);
});

test('create rejects arbitrary cwd even inside an authorized workspace', async () => {
  const { adapter, calls } = setup();
  await assert.rejects(adapter.create({ workspaceId: 'ws-a', cwd: '/tmp' }), { code: 'unsupported_parameter' });
  assert.equal(calls.some(([method]) => method === 'create'), false);
});

test('follow stamps session identity and separates durable and ephemeral frames', async () => {
  const { adapter, emitted } = setup();
  const result = await adapter.follow({ sessionId: 's1', workspaceId: 'ws-a', cursor: 1 });
  assert.equal(result.accepted, true);
  assert.equal(result.sessionId, 's1');
  assert.equal(result.requestedCursor, 1);
  assert.equal(result.recovery, 'latest_snapshot');
  assert.equal(typeof result.followId, 'string');
  for (let i = 0; i < 20 && emitted.length < 3; i += 1) await new Promise(setImmediate);
  assert.equal(emitted.length, 3);
  const snapshot = eventAt(emitted, 0);
  const sessionEvent = eventAt(emitted, 1);
  const assistantEvent = eventAt(emitted, 2);
  assert.equal(snapshot.kind, 'session.snapshot');
  const snapshotData = asRecord(snapshot.data);
  const records = snapshotData.records;
  assert.ok(Array.isArray(records));
  const firstRecord = asRecord(records[0]);
  const wireEvent = asRecord(firstRecord.event);
  assert.equal(wireEvent.sessionId, 's1');
  assert.equal(sessionEvent.kind, 'session.event');
  assert.equal(sessionEvent.sessionId, 's1');
  assert.equal(sessionEvent.seq, 2);
  assert.equal(sessionEvent.occurredAt, '1970-01-01T00:00:02.000Z');
  assert.equal(assistantEvent.kind, 'assistant.stream');
  assert.equal('seq' in assistantEvent, false);
  assert.equal(asRecord(assistantEvent.data).phase, 'delta');
  assert.equal(asRecord(assistantEvent.data).text, 'ok');
});

test('compact follow omits the bulky opening snapshot payload', async () => {
  const { adapter, emitted } = setup();
  await adapter.follow({ sessionId: 's1', workspaceId: 'ws-a', compact: true });
  for (let i = 0; i < 20 && emitted.length < 1; i += 1) await new Promise(setImmediate);
  const snapshot = eventAt(emitted, 0);
  assert.equal(snapshot.kind, 'session.snapshot');
  const data = asRecord(snapshot.data);
  assert.equal(data.compact, true);
  assert.equal('records' in data, false);
  assert.equal('projections' in data, false);
  adapter.dispose();
});

test('detaching a session revokes its old workspace authorization', async () => {
  const { adapter, calls, workspaces } = setup();
  await adapter.page({ sessionId: 's1' }, { signal: new AbortController().signal });
  workspaces[0].sessionIds = [];
  await assert.rejects(adapter.prompt({
    sessionId: 's1', content: [{ type: 'text', text: 'must not run' }],
  }, { signal: new AbortController().signal, requestId: 'req-detached' }), { code: 'workspace_forbidden' });
  assert.equal(calls.some(([method]) => method === 'prompt'), false);
});

test('moving a session to an unauthorized workspace revokes an active follow', async () => {
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const { adapter, emitted, workspaces } = setup({
    controller: {
      follow() {
        return (async function* () {
          yield {
            type: 'snapshot', header: { id: 's1', createdAt: 500, version: 1, isSeeded: false },
            cursor: 1, records: [], hasMore: false, projections: { asOfSeq: 1, values: {} },
          };
          await waiting;
          yield { type: 'event', event: { type: 'turn/end', seq: 2, time: 2_000, data: {} } };
        }());
      },
    },
  });
  await adapter.follow({ sessionId: 's1', followId: 'follow-old' });
  for (let i = 0; i < 20 && emitted.length < 1; i += 1) await new Promise(setImmediate);
  assert.equal(eventAt(emitted, 0).kind, 'session.snapshot');
  workspaces[0].sessionIds = [];
  workspaces[1].sessionIds.push('s1');
  assert.ok(release);
  release();
  for (let i = 0; i < 20 && emitted.length < 2; i += 1) await new Promise(setImmediate);
  assert.equal(emitted.length, 2);
  const error = eventAt(emitted, 1);
  assert.equal(error.kind, 'connector.error');
  assert.equal(asRecord(error.data).code, 'workspace_forbidden');
});

test('list workspaceId filters the requested authorized subset', async () => {
  const { adapter, workspaces } = setup();
  workspaces[0].sessionIds.push('s2');
  const result = await adapter.list({ workspaceId: 'ws-b' }, { signal: new AbortController().signal });
  assert.deepEqual(result.sessions, []);
});

test('invalid follow cursors fail instead of becoming a null requestedCursor', async () => {
  const { adapter } = setup();
  await assert.rejects(adapter.follow({ sessionId: 's1', cursor: 'not-a-number' }), { code: 'invalid_request' });
});

test('transcript keeps conversation text and omits reasoning, tool calls and results', async () => {
  const records = [
    { type: 'event' as const, event: { type: 'user/message', seq: 1, time: 1_000, data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }] } } },
    { type: 'event' as const, event: { type: 'turn/start', seq: 2, time: 1_500, data: { turn: 1 } } },
    { type: 'event' as const, event: { type: 'assistant/message', seq: 3, time: 2_000, data: { message: { id: 'a1', content: [{ type: 'reasoning', text: 'private chain of thought' }, { type: 'text', text: 'hi there' }] } } } },
    { type: 'event' as const, event: { type: 'tool/call', seq: 4, time: 3_000, data: { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } } },
    { type: 'event' as const, event: { type: 'tool/result', seq: 5, time: 4_000, data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: 'file.txt' }], isError: false } } } },
    { type: 'event' as const, event: { type: 'turn/end', seq: 6, time: 5_000, data: { reason: 'completed' } } },
  ];
  const throughSeqs: number[] = [];
  const { adapter } = setup({
    controller: {
      async list() {
        return {
          items: [{
            sessionId: 's1',
            updatedAt: 1_000,
            running: false,
            blank: false,
            agentAvailable: true,
            projections: { kind: 'cached', asOfSeq: 99, values: { title: 'Authorized session' } },
          }],
        };
      },
      async page(request) {
        throughSeqs.push(request.throughSeq);
        return { records, hasMore: true };
      },
    },
  });
  const result = await adapter.transcript(
    { sessionId: 's1', workspaceId: 'ws-a', limit: 20 },
    { signal: new AbortController().signal },
  );
  assert.deepEqual(throughSeqs, [99]);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0]?.role, 'user');
  assert.equal(result.messages[0]?.text, 'hello');
  assert.equal(result.messages[1]?.role, 'assistant');
  assert.equal(result.messages[1]?.text, 'hi there');
  assert.equal(result.messages.some((message) => message.role === 'tool'), false);
  assert.equal(result.active, false);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, '1');
});

test('transcript omits injected time, runtime and skill context', async () => {
  const records = [
    {
      type: 'event' as const,
      event: {
        type: 'user/message', seq: 1, time: 1_000,
        data: { content: [{ type: 'text', text: 'Time sampled while preparing turn 1' }], source: { kind: 'time-context' } },
      },
    },
    {
      type: 'event' as const,
      event: {
        type: 'user/message', seq: 2, time: 1_100,
        data: { content: [{ type: 'text', text: 'Current runtime context.' }], source: { kind: 'runtime-context' } },
      },
    },
    {
      type: 'event' as const,
      event: {
        type: 'user/message', seq: 3, time: 1_200,
        data: { content: [{ type: 'text', text: '<system-reminder>skills</system-reminder>' }], source: { kind: 'skill-catalog' } },
      },
    },
    {
      type: 'event' as const,
      event: {
        type: 'user/message', seq: 4, time: 1_300,
        data: { content: [{ type: 'text', text: 'real question' }], source: { kind: 'user' } },
      },
    },
  ];
  const { adapter } = setup({
    controller: {
      async page() { return { records, hasMore: false }; },
    },
  });
  const result = await adapter.transcript(
    { sessionId: 's1', workspaceId: 'ws-a' },
    { signal: new AbortController().signal },
  );
  assert.deepEqual(result.messages.map((message) => message.text), ['real question']);
});

test('transcript pages at the current DSH watermark instead of the legacy -1 sentinel', async () => {
  const throughSeqs: number[] = [];
  const { adapter } = setup({
    controller: {
      async page(request) {
        throughSeqs.push(request.throughSeq);
        return { records: [], hasMore: false };
      },
    },
  });
  await adapter.transcript(
    { sessionId: 's1', workspaceId: 'ws-a' },
    { signal: new AbortController().signal },
  );
  assert.deepEqual(throughSeqs, [99]);
});

test('page resolves the latest DSH watermark before applying the exclusive cursor', async () => {
  const requests: SessionPageRequest[] = [];
  const { adapter } = setup({
    controller: {
      async page(request) {
        requests.push(request);
        return { records: [], hasMore: true };
      },
    },
  });
  await adapter.page(
    { sessionId: 's1', workspaceId: 'ws-a', cursor: '42', limit: 10 },
    { signal: new AbortController().signal },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.throughSeq, 99);
  assert.equal(requests[0]?.beforeSeq, 42);
  assert.equal(requests[0]?.maxMessages, 10);
});

test('transcript reports running state from the session list when the page has no turn marker', async () => {
  const { adapter } = setup({
    controller: {
      async page() {
        return {
          records: [{
            type: 'event' as const,
            event: { type: 'user/message', seq: 98, time: 1_000, data: { content: [{ type: 'text', text: 'run' }] } },
          }],
          hasMore: false,
        };
      },
    },
  });
  const result = await adapter.transcript(
    { sessionId: 's1', workspaceId: 'ws-a' },
    { signal: new AbortController().signal },
  );
  assert.equal(result.active, true);
});

test('transcript rejects a workspace claim that does not own the session', async () => {
  const { adapter } = setup();
  await assert.rejects(
    adapter.transcript({ sessionId: 's1', workspaceId: 'ws-b' }, { signal: new AbortController().signal }),
    { code: 'workspace_mismatch' },
  );
});
