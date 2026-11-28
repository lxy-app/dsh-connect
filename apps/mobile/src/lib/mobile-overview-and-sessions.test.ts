import assert from 'node:assert/strict';
import test from 'node:test';

import { settleMobileOverviewAndSessions } from '@shared/lib/mobile-overview-and-sessions';
import type { MobileAccessOverview, MobileSessionList } from '@shared/types/mobile';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('publishes desktop access before a slow session list settles', async () => {
  const overviewRequest = deferred<MobileAccessOverview>();
  const sessionsRequest = deferred<MobileSessionList>();
  const overview = { desktops: [] };
  const published: string[] = [];
  const pending = settleMobileOverviewAndSessions(overviewRequest.promise, sessionsRequest.promise, {
    overview: (value) => {
      assert.equal(value, overview);
      published.push('overview');
    },
    sessions: () => published.push('sessions'),
  });

  overviewRequest.resolve(overview);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(published, ['overview']);

  sessionsRequest.reject(new Error('session timeout'));
  const result = await pending;
  assert.equal(result.overview.status, 'fulfilled');
  assert.equal(result.sessions.status, 'rejected');
  assert.deepEqual(published, ['overview']);
});

test('keeps a successful session list when desktop access fails', async () => {
  const sessions = { sessions: [], warnings: [] };
  const published: string[] = [];
  const result = await settleMobileOverviewAndSessions(
    Promise.reject(new Error('access failed')),
    Promise.resolve(sessions),
    {
      overview: () => published.push('overview'),
      sessions: (value) => {
        assert.equal(value, sessions);
        published.push('sessions');
      },
    },
  );

  assert.equal(result.overview.status, 'rejected');
  assert.equal(result.sessions.status, 'fulfilled');
  assert.deepEqual(published, ['sessions']);
});
