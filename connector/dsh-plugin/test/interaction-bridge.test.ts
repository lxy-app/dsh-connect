import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandHandler } from '../src/lib/command-handler.js';
import { InteractionBridge } from '../src/lib/interaction-bridge.js';
import { WorkspacePolicy } from '../src/lib/workspace-policy.js';
import type { MessageTransport, TransportEnvelope } from '../src/types.js';

type Listener = (...args: never[]) => unknown;

function fakeCordis() {
  const listeners = new Map<string, Listener[]>();
  return {
    ctx: {
      on(name: string, listener: Listener): () => void {
        const list = listeners.get(name) ?? [];
        list.push(listener);
        listeners.set(name, list);
        return () => {
          const index = list.indexOf(listener);
          if (index >= 0) list.splice(index, 1);
        };
      },
    },
    registered(name: string): number {
      return listeners.get(name)?.length ?? 0;
    },
    fire(name: string, ...args: unknown[]): unknown {
      const listener = listeners.get(name)?.[0];
      assert.ok(listener, `no listener registered for ${name}`);
      return listener(...(args as never[]));
    },
  };
}

const registry = {
  list: () => [{
    id: 'ws-1',
    path: '/work/a',
    title: 'Project A',
    sessionIds: ['sess-1'],
    createdAt: 'now',
    updatedAt: 'now',
  }],
};

function policy(scopes: readonly string[] = ['read', 'approve']): WorkspacePolicy {
  return new WorkspacePolicy({ workspaces: [{ id: 'ws-1', name: 'Project A' }], scopes: scopes as never });
}

type SentMessage = TransportEnvelope & {
  kind?: string;
  data?: { interactionId?: string; resolution?: string; [key: string]: unknown };
  result?: unknown;
  error?: { code?: string };
};

class FakeTransport implements MessageTransport {
  readonly connected = true;
  readonly sent: SentMessage[] = [];

  send(message: TransportEnvelope): void {
    this.sent.push(message as SentMessage);
  }
}

function build(
  scopes: readonly string[] = ['read', 'approve'],
  options: { watching?: boolean; graceMs?: number; audienceThrows?: boolean; logs?: string[] } = {},
) {
  const cordis = fakeCordis();
  const transport = new FakeTransport();
  const state = { audienceCalls: 0, watching: options.watching ?? true };
  const logs = options.logs ?? [];
  const bridge = new InteractionBridge({
    ctx: cordis.ctx,
    workspaceRegistry: registry,
    policy: policy(scopes),
    deviceId: 'dev-1',
    emit: (event) => transport.send(event),
    graceMs: options.graceMs ?? 60_000,
    logger: { info: (message) => logs.push(message) },
    audience: async () => {
      state.audienceCalls += 1;
      if (options.audienceThrows) throw new Error('server offline');
      return state.watching;
    },
  });
  bridge.attach();
  return { bridge, cordis, transport, state, logs };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function approvalRequest(signal?: AbortSignal) {
  return {
    agent: { id: 'sess-1' },
    toolName: 'bash',
    callId: 'call-1',
    reason: 'restart Chrome',
    displayReason: { en: 'Restart Chrome', zh: '重启 Chrome' },
    ...(signal ? { signal } : {}),
  };
}

test('a watching phone answers without starting the desktop prompt', async () => {
  const { bridge, cordis, transport, state } = build();
  let desktopCalled = 0;
  const result = cordis.fire('approval/request', approvalRequest(), () => {
    desktopCalled += 1;
    return new Promise<string>(() => undefined);
  }) as Promise<string>;
  await tick();
  assert.equal(state.audienceCalls, 1);
  assert.equal(desktopCalled, 0);

  const request = transport.sent.find((message) => message.kind === 'interaction.request');
  assert.ok(request?.data?.interactionId);
  const requestData = request.data;
  assert.equal(requestData.kind, 'approval');
  assert.equal(requestData.title, 'bash');
  assert.equal(requestData.reason, 'Restart Chrome');
  assert.equal(requestData.workspaceId, 'ws-1');
  assert.equal(requestData.workspaceName, 'Project A');

  bridge.respond({ interactionId: String(requestData.interactionId), kind: 'approval', decision: 'allow-once' });
  assert.equal(await result, 'allowed-once');
  assert.equal(desktopCalled, 0);
  const resolved = transport.sent.find((message) => message.kind === 'interaction.resolved');
  assert.equal(resolved?.data?.resolution, 'remote');
});

test('the desktop takes over after the grace and the phone copy is withdrawn first', async () => {
  const { bridge, cordis, transport } = build(['read', 'approve'], { watching: true, graceMs: 300 });
  let desktopCalled = 0;
  const result = cordis.fire('approval/request', approvalRequest(), () => {
    desktopCalled += 1;
    return Promise.resolve('allowed-once');
  }) as Promise<string>;
  await sleep(450);

  assert.equal(desktopCalled, 1);
  assert.equal(await result, 'allowed-once');
  const kinds = transport.sent.map((message) => `${message.kind}:${message.data?.resolution ?? ''}`);
  assert.deepEqual(kinds.filter((kind) => kind.startsWith('interaction.resolved')), ['interaction.resolved:desktop']);
  const request = transport.sent.find((message) => message.kind === 'interaction.request');
  const interactionId = String(request?.data?.interactionId ?? '');
  assert.ok(interactionId);
  assert.throws(
    () => bridge.respond({ interactionId, kind: 'approval', decision: 'reject' }),
    /no longer pending/,
  );
});

test('no watching phone leaves the desktop chain untouched', async () => {
  const { cordis, transport, state } = build(['read', 'approve'], { watching: false });
  const result = await cordis.fire('approval/request', approvalRequest(), () => Promise.resolve('rejected'));
  assert.equal(result, 'rejected');
  assert.equal(state.audienceCalls, 1);
  assert.equal(transport.sent.length, 0);
});

test('an audience failure falls back to the desktop', async () => {
  const { cordis, transport } = build(['read', 'approve'], { audienceThrows: true });
  const result = await cordis.fire('approval/request', approvalRequest(), () => Promise.resolve('rejected'));
  assert.equal(result, 'rejected');
  assert.equal(transport.sent.length, 0);
});

test('scopes without approve leave the desktop chain untouched', async () => {
  const { cordis, transport, state } = build(['read', 'prompt']);
  assert.equal(cordis.registered('approval/request'), 1);
  const result = await cordis.fire('approval/request', approvalRequest(), () => Promise.resolve('rejected'));
  assert.equal(result, 'rejected');
  assert.equal(state.audienceCalls, 0);
  assert.equal(transport.sent.length, 0);
});

test('questions relay options and reject unknown selections', async () => {
  const { bridge, cordis, transport } = build();
  const result = cordis.fire('user-questions/request', {
    agent: { id: 'sess-1' },
    questions: [{
      id: 'q1',
      question: 'Restart Chrome?',
      header: '浏览器授权',
      options: [{ label: '允许重启 Chrome' }, { label: '暂不允许' }],
    }],
    wait: { callId: 'call-9' },
  }, () => new Promise(() => undefined)) as Promise<{ answers: { id: string; selected: string[] }[] }>;
  await tick();
  const request = transport.sent.find((message) => message.kind === 'interaction.request');
  assert.ok(request?.data?.interactionId);
  const requestData = request.data;
  assert.equal(requestData.kind, 'question');
  const questions = requestData.questions as { id: string; options?: unknown[] }[];
  assert.equal(questions[0]?.id, 'q1');
  assert.equal(questions[0]?.options?.length, 2);

  assert.throws(
    () => bridge.respond({
      interactionId: String(requestData.interactionId),
      kind: 'question',
      answers: [{ id: 'q1', selected: ['not-an-option'] }],
    }),
    /not offered/,
  );
  bridge.respond({
    interactionId: String(requestData.interactionId),
    kind: 'question',
    answers: [{ id: 'q1', selected: ['允许重启 Chrome'] }],
  });
  assert.deepEqual(await result, { answers: [{ id: 'q1', selected: ['允许重启 Chrome'] }] });
});

test('aborting the DSH request settles the phone prompt as cancelled', async () => {
  const { cordis, transport } = build();
  const controller = new AbortController();
  const result = cordis.fire('approval/request', approvalRequest(controller.signal),
    () => new Promise(() => undefined)) as Promise<string>;
  await tick();
  controller.abort();
  assert.equal(await result, 'cancelled');
  assert.equal(
    transport.sent.find((message) => message.kind === 'interaction.resolved')?.data?.resolution,
    'cancelled',
  );
});

test('command handler routes interaction.respond to the bridge', async () => {
  const { bridge, cordis, transport } = build();
  const pending = cordis.fire('approval/request', approvalRequest(),
    () => new Promise(() => undefined)) as Promise<string>;
  await tick();
  const request = transport.sent.find((message) => message.kind === 'interaction.request');
  assert.ok(request?.data?.interactionId);
  const interactionId = String(request.data.interactionId);
  const commandTransport = new FakeTransport();
  const handler = new CommandHandler({
    transport: commandTransport,
    host: {},
    interactions: bridge,
  });
  await handler.handle({
    v: 1,
    type: 'command',
    requestId: 'req-int-1',
    method: 'interaction.respond',
    params: { interactionId, kind: 'approval', decision: 'allow-once' },
  });
  assert.equal(await pending, 'allowed-once');
  assert.deepEqual(commandTransport.sent[0]?.result, { accepted: true, interactionId });
});

test('a desktop without the approve scope reports the declined relay', async () => {
  const logs: string[] = [];
  const { cordis, state, transport } = build(['read', 'prompt'], { logs });
  const result = await cordis.fire('approval/request', approvalRequest(), () => Promise.resolve('rejected'));
  assert.equal(result, 'rejected');
  assert.equal(state.audienceCalls, 0);
  assert.equal(transport.sent.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? '', /kind=approval/);
  assert.match(logs[0] ?? '', /reason=desktop-scope-missing/);
  assert.match(logs[0] ?? '', /session=sess-1/);
  assert.match(logs[0] ?? '', /workspace=ws-1/);
});

test('a session outside every workspace reports the declined relay', async () => {
  const logs: string[] = [];
  const { cordis } = build(['read', 'approve'], { logs });
  await cordis.fire(
    'approval/request',
    { agent: { id: 'sess-elsewhere' }, toolName: 'bash' },
    () => Promise.resolve('rejected'),
  );
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? '', /reason=session-not-in-workspace/);
  assert.match(logs[0] ?? '', /session=sess-elsewhere/);
});

test('a workspace the desktop has not granted reports the declined relay', async () => {
  const cordis = fakeCordis();
  const logs: string[] = [];
  const bridge = new InteractionBridge({
    ctx: cordis.ctx,
    workspaceRegistry: {
      list: () => [{
        id: 'ws-2',
        path: '/work/b',
        title: 'Project B',
        sessionIds: ['sess-2'],
        createdAt: 'now',
        updatedAt: 'now',
      }],
    },
    policy: policy(['read', 'approve']),
    deviceId: 'dev-1',
    emit: () => undefined,
    logger: { info: (message) => logs.push(message) },
    audience: async () => true,
  });
  bridge.attach();
  await cordis.fire(
    'approval/request',
    { agent: { id: 'sess-2' }, toolName: 'bash' },
    () => Promise.resolve('rejected'),
  );
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? '', /reason=desktop-workspace-not-granted/);
  assert.match(logs[0] ?? '', /workspace=ws-2/);
});

test('an idle phone reports why the prompt stayed on the desktop', async () => {
  const logs: string[] = [];
  const { cordis, state, transport } = build(['read', 'approve'], { watching: false, logs });
  const result = await cordis.fire('approval/request', approvalRequest(), () => Promise.resolve('rejected'));
  assert.equal(result, 'rejected');
  assert.equal(state.audienceCalls, 1);
  assert.equal(transport.sent.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? '', /reason=no-watching-phone/);
  assert.match(logs[0] ?? '', /tool=bash/);
});

test('a relayed prompt logs nothing because the phone owns it', async () => {
  const logs: string[] = [];
  const { cordis, transport } = build(['read', 'approve'], { logs });
  void cordis.fire('approval/request', approvalRequest(), () => new Promise(() => undefined));
  await tick();
  assert.equal(logs.length, 0);
  assert.ok(transport.sent.some((message) => message.kind === 'interaction.request'));
});
