import assert from 'node:assert/strict';
import test from 'node:test';

import { KeyedPublishQueue } from '@shared/lib/keyed-publish-queue';

test('same-key publications share one task and different keys stay independent', async () => {
  const queue = new KeyedPublishQueue<string>();
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const publish = () => queue.run('same', async () => {
    calls += 1;
    await gate;
    return 'complete';
  });
  const first = publish();
  const second = publish();
  assert.equal(queue.get('same'), first);
  assert.equal(calls, 0);
  release?.();
  assert.deepEqual(await Promise.all([first, second]), ['complete', 'complete']);
  assert.equal(calls, 1);
  assert.equal(await queue.run('other', async () => 'other'), 'other');
});

test('failed publications leave no pending entry and can be retried', async () => {
  const queue = new KeyedPublishQueue<string>();
  await assert.rejects(queue.run('key', async () => { throw new Error('write failed'); }), /write failed/);
  assert.equal(queue.get('key'), null);
  assert.equal(await queue.run('key', async () => 'ok'), 'ok');
});
