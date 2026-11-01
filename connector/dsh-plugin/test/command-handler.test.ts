import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandHandler } from '../src/lib/command-handler.js';
import type { CommandContext } from '../src/lib/command-handler.js';
import type { MessageTransport, TransportEnvelope } from '../src/types.js';

type SentMessage = TransportEnvelope & {
  result?: { accepted?: boolean };
  error?: { code?: string; retryable?: boolean };
};

class FakeTransport implements MessageTransport {
  readonly connected = true;
  readonly sent: SentMessage[] = [];

  send(message: TransportEnvelope): void {
    this.sent.push(message as SentMessage);
  }
}

test('routes Host calls with requestId and AbortSignal', async () => {
  const transport = new FakeTransport();
  let received: { params: unknown; context: CommandContext } | undefined;
  const handler = new CommandHandler({
    transport,
    host: {
      async list(params, context) {
        received = { params, context };
        return { sessions: [{ id: 'session-1' }] };
      },
    },
  });
  await handler.handle({
    v: 1, type: 'command', requestId: 'req-1', method: 'session.list', params: { deviceId: 'dev-1' },
  });
  assert.ok(received);
  assert.equal(received.context.requestId, 'req-1');
  assert.equal(received.context.signal instanceof AbortSignal, true);
  assert.deepEqual(transport.sent[0], {
    v: 1,
    type: 'result',
    requestId: 'req-1',
    result: { sessions: [{ id: 'session-1' }] },
  });
});

test('the same prompt requestId reaches Host exactly once', async () => {
  const transport = new FakeTransport();
  let calls = 0;
  const host = { async prompt() { calls += 1; return { accepted: true }; } };
  const handler = new CommandHandler({ transport, host });
  const command = { v: 1, type: 'command', requestId: 'req-2', method: 'session.prompt' };
  await Promise.all([handler.handle(command), handler.handle(command)]);
  await handler.handle(command);
  assert.equal(calls, 1);
  assert.equal(transport.sent.length, 3);
  assert.ok(transport.sent.every((message) => message.result?.accepted));
});

test('the same requestId with different params returns idempotency_conflict', async () => {
  const transport = new FakeTransport();
  let calls = 0;
  const handler = new CommandHandler({
    transport,
    host: { async cancel(params) { calls += 1; return { accepted: true, sessionId: params.sessionId }; } },
  });
  await handler.handle({
    v: 1, type: 'command', requestId: 'req-conflict', method: 'session.cancel', params: { sessionId: 's1' },
  });
  await handler.handle({
    v: 1, type: 'command', requestId: 'req-conflict', method: 'session.cancel', params: { sessionId: 's2' },
  });
  assert.equal(calls, 1);
  assert.equal(transport.sent[1]?.error?.code, 'idempotency_conflict');
});

test('equivalent params with different key order share the cached outcome', async () => {
  const transport = new FakeTransport();
  let calls = 0;
  const handler = new CommandHandler({
    transport,
    host: { async list() { calls += 1; return { sessions: [] }; } },
  });
  await handler.handle({ v: 1, type: 'command', requestId: 'req-order', method: 'session.list', params: { a: 1, b: 2 } });
  await handler.handle({ v: 1, type: 'command', requestId: 'req-order', method: 'session.list', params: { b: 2, a: 1 } });
  assert.equal(calls, 1);
  assert.equal(transport.sent[1]?.type, 'result');
});

test('timeout aborts Host invocation and returns a stable error', async () => {
  const transport = new FakeTransport();
  const handler = new CommandHandler({
    transport,
    maxTimeoutMs: 5,
    host: {
      prompt(_params, { signal }) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    },
  });
  await handler.handle({ v: 1, type: 'command', requestId: 'req-3', method: 'session.prompt' });
  assert.equal(transport.sent[0]?.error?.code, 'command_timeout');
  assert.equal(transport.sent[0]?.error?.retryable, false);
});

test('a lost response does not replace a completed Host outcome with an offline error', async () => {
  const offline = Object.assign(new Error('offline'), { code: 'connector_offline' });
  const transport: MessageTransport = {
    connected: true,
    send() { throw offline; },
  };
  let calls = 0;
  const handler = new CommandHandler({ transport, host: { async prompt() { calls += 1; return { accepted: true }; } } });
  await assert.doesNotReject(handler.handle({
    v: 1, type: 'command', requestId: 'req-5', method: 'session.prompt',
  }));
  assert.equal(calls, 1);
});

test('unknown methods fail without reaching Host', async () => {
  const transport = new FakeTransport();
  const handler = new CommandHandler({ transport, host: {} });
  await handler.handle({ v: 1, type: 'command', requestId: 'req-4', method: 'shell.exec' });
  assert.equal(transport.sent[0]?.error?.code, 'method_not_found');
});
