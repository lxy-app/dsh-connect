import assert from 'node:assert/strict';
import test from 'node:test';
import { ReconnectBackoff } from '../src/lib/backoff.js';

test('backoff grows exponentially and is capped', () => {
  const backoff = new ReconnectBackoff({ initialMs: 100, maxMs: 400, random: () => 1 });
  assert.deepEqual([backoff.next(), backoff.next(), backoff.next(), backoff.next()], [100, 200, 400, 400]);
});

test('jitter stays within the lower half to upper bound', () => {
  const low = new ReconnectBackoff({ initialMs: 100, random: () => 0 });
  const high = new ReconnectBackoff({ initialMs: 100, random: () => 1 });
  assert.equal(low.next(), 50);
  assert.equal(high.next(), 100);
});

test('a successful connection can reset backoff', () => {
  const backoff = new ReconnectBackoff({ initialMs: 100, random: () => 1 });
  backoff.next();
  backoff.next();
  backoff.reset();
  assert.equal(backoff.next(), 100);
});
