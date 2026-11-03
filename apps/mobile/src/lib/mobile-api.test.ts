import assert from 'node:assert/strict';
import test from 'node:test';

import { createMobileSession, getMobileTranscript, MobileApiError } from './mobile-api';

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
