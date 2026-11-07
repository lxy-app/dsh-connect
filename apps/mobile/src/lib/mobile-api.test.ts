import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMobileSession,
  getMobileSessionModel,
  getMobileTranscript,
  MobileApiError,
  selectMobileSessionModel,
} from './mobile-api';

test('mobile session create posts only the supported grant-scoped fields', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestedUrl = '';
  let authorization = '';
  let requestBody = '';
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get('Authorization') ?? '';
    requestBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ sessionId: 'sess-created', workspaceId: 'ws-1', agentPreset: 'default' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const created = await createMobileSession('https://connect.example.com/', 'mobile-token', {
    requestId: 'mcr-1', deviceId: 'dev-1', workspaceId: 'ws-1',
  });

  assert.equal(requestedUrl, 'https://connect.example.com/v1/mobile/sessions');
  assert.equal(authorization, 'Bearer mobile-token');
  assert.deepEqual(JSON.parse(requestBody), { requestId: 'mcr-1', deviceId: 'dev-1', workspaceId: 'ws-1' });
  assert.equal(requestBody.includes('mobile-token'), false);
  assert.deepEqual(created, { sessionId: 'sess-created', workspaceId: 'ws-1', agentPreset: 'default' });
});

test('mobile session create rejects an incomplete desktop result', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ sessionId: 'sess-created' }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

  await assert.rejects(
    createMobileSession('https://connect.example.com', 'mobile-token', {
      requestId: 'mcr-1', deviceId: 'dev-1', workspaceId: 'ws-1',
    }),
    (error: unknown) => error instanceof MobileApiError && error.code === 'invalid_response',
  );
});

test('mobile transcript preserves delivered attachments and delivery-only messages', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    sessionId: 'sess-1',
    deviceId: 'dev-1',
    workspaceId: 'ws-1',
    messages: [{
      id: 'delivery-12-0',
      seq: 12,
      role: 'assistant',
      text: '',
      delivery: true,
      occurredAt: '2026-11-03T01:00:00.000Z',
      attachments: [{
        attachmentId: 'att_b7Qk2m9xT4pL0rVc8sN1',
        kind: 'image',
        name: 'architecture.png',
        mime: 'image/png',
        bytes: 184320,
        width: 1280,
        height: 720,
        source: 'deliverable',
        description: '本轮的架构图',
        state: 'ready',
        sha256: '9f2c0123456789abcdef',
      }],
    }],
    hasMore: false,
    active: false,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const transcript = await getMobileTranscript(
    'https://connect.example.com',
    'mobile-token',
    'sess-1',
    { deviceId: 'dev-1', workspaceId: 'ws-1' },
  );

  assert.equal(transcript.messages.length, 1);
  assert.equal(transcript.messages[0]?.delivery, true);
  assert.deepEqual(transcript.messages[0]?.attachments, [{
    attachmentId: 'att_b7Qk2m9xT4pL0rVc8sN1',
    kind: 'image',
    name: 'architecture.png',
    mime: 'image/png',
    bytes: 184320,
    width: 1280,
    height: 720,
    source: 'deliverable',
    description: '本轮的架构图',
    state: 'ready',
    sha256: '9f2c0123456789abcdef',
  }]);
});

test('mobile transcript keeps folded tool steps and their turn metadata', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    sessionId: 'sess-1',
    deviceId: 'dev-1',
    workspaceId: 'ws-1',
    messages: [{
      id: 'tool-call-1',
      seq: 9,
      role: 'tool',
      text: '',
      toolName: 'bash',
      toolCallId: 'call-1',
      summary: 'pnpm test --workspace server',
      status: 'ok',
      durationMs: 1500,
      turn: 3,
      occurredAt: '2026-11-03T01:00:00.000Z',
    }],
    hasMore: false,
    active: false,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const transcript = await getMobileTranscript(
    'https://connect.example.com',
    'mobile-token',
    'sess-1',
    { deviceId: 'dev-1', workspaceId: 'ws-1' },
  );

  assert.deepEqual(
    {
      role: transcript.messages[0]?.role,
      summary: transcript.messages[0]?.summary,
      status: transcript.messages[0]?.status,
      durationMs: transcript.messages[0]?.durationMs,
      turn: transcript.messages[0]?.turn,
    },
    { role: 'tool', summary: 'pnpm test --workspace server', status: 'ok', durationMs: 1_500, turn: 3 },
  );
});

test('mobile model catalog uses the granted query and parses nested reasoning metadata', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestedUrl = '';
  let authorization = '';
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get('Authorization') ?? '';
    return new Response(JSON.stringify({
      sessionId: 'sess-1', deviceId: 'dev-1', workspaceId: 'ws-1',
      default: { provider: 'deepseek', model: 'deepseek-chat' },
      lastUsed: null,
      next: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
      effective: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
      routableProviders: ['deepseek'],
      groups: [{
        id: 'deepseek', name: 'DeepSeek',
        models: [{
          id: 'deepseek-reasoner', name: 'DeepSeek Reasoner',
          reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
          badge: { text: { en: 'Reasoning', 'zh-CN': '推理' }, tone: 'blue' },
        }],
      }],
      failures: [], projectionKind: 'sequenced',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const catalog = await getMobileSessionModel('https://connect.example.com/', 'mobile-token', 'sess-1', {
    deviceId: 'dev-1', workspaceId: 'ws-1',
  });
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, '/v1/mobile/sessions/sess-1/model');
  assert.equal(url.searchParams.get('deviceId'), 'dev-1');
  assert.equal(url.searchParams.get('workspaceId'), 'ws-1');
  assert.equal(authorization, 'Bearer mobile-token');
  assert.equal(catalog.effective.reasoningEffort, 'high');
  assert.equal(catalog.groups[0]?.models[0]?.reasoning?.defaultEffort, 'high');
  assert.deepEqual(catalog.groups[0]?.models[0]?.badge, {
    text: { en: 'Reasoning', 'zh-CN': '推理' }, tone: 'blue',
  });
});

test('mobile model selection posts the complete stable request without exposing the token', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestedUrl = '';
  let requestBody = '';
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = String(init?.body ?? '');
    return new Response(JSON.stringify({
      sessionId: 'sess-1', requestId: 'model-1',
      selected: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await selectMobileSessionModel('https://connect.example.com', 'mobile-token', 'sess-1', {
    requestId: 'model-1', deviceId: 'dev-1', workspaceId: 'ws-1',
    provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high',
  });
  assert.equal(requestedUrl, 'https://connect.example.com/v1/mobile/sessions/sess-1/model');
  assert.deepEqual(JSON.parse(requestBody), {
    requestId: 'model-1', deviceId: 'dev-1', workspaceId: 'ws-1',
    provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high',
  });
  assert.equal(requestBody.includes('mobile-token'), false);
  assert.equal(result.selected.reasoningEffort, 'high');
});
