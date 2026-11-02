import assert from 'node:assert/strict';
import test from 'node:test';

import { createMobileSession, MobileApiError } from './mobile-api';

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
