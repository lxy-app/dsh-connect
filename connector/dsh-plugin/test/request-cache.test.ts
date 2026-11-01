import assert from 'node:assert/strict';
import test from 'node:test';
import { RequestCache } from '../src/lib/request-cache.js';

test('concurrent requests share one operation and outcome', async () => {
  const cache = new RequestCache();
  let calls = 0;
  let release!: () => void;
  const operation = (): Promise<{ accepted: boolean }> => new Promise((resolve) => {
    calls += 1;
    release = () => resolve({ accepted: true });
  });

  const first = cache.execute('req-1', 'session.prompt', operation);
  const second = cache.execute('req-1', 'session.prompt', operation);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, { accepted: true });
  assert.deepEqual(await second, { accepted: true });
  assert.deepEqual(await cache.execute('req-1', 'session.prompt', operation), { accepted: true });
  assert.equal(calls, 1);
});

test('a timeout outcome is retained to prevent blind resubmission', async () => {
  const cache = new RequestCache();
  let calls = 0;
  const failure = Object.assign(new Error('timeout'), { code: 'command_timeout' });
  const operation = async (): Promise<never> => {
    calls += 1;
    throw failure;
  };

  await assert.rejects(cache.execute('req-2', 'session.prompt', operation), failure);
  await assert.rejects(cache.execute('req-2', 'session.prompt', operation), failure);
  assert.equal(calls, 1);
});

test('a requestId cannot be reused for a different method', async () => {
  const cache = new RequestCache();
  await cache.execute('req-3', 'session.list', async () => []);
  await assert.rejects(
    cache.execute('req-3', 'session.prompt', async () => ({})),
    { code: 'idempotency_conflict' },
  );
});

test('expired outcomes can be executed again', async () => {
  let now = 100;
  const cache = new RequestCache({ ttlMs: 10, now: () => now });
  let calls = 0;
  const operation = async (): Promise<number> => ++calls;
  assert.equal(await cache.execute('req-4', 'session.list', operation), 1);
  now = 111;
  assert.equal(await cache.execute('req-4', 'session.list', operation), 2);
});
