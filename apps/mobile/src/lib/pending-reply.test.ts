import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePendingReply } from './pending-reply';

test('new-session waiting survives an empty transcript without a completed turn', () => {
  const pending = { since: 1, afterSeq: 0, text: '' };
  assert.equal(resolvePendingReply(pending, { messages: [] }), pending);
});

test('new-session waiting clears when the first turn ends without assistant text', () => {
  assert.equal(resolvePendingReply(
    { since: 1, afterSeq: 0, text: '' },
    { messages: [{ role: 'user', text: 'first', seq: 1 }], turnEndSeq: 3 },
  ), null);
});

test('follow-up waiting ignores a historical turn end before the new user message', () => {
  const pending = { since: 1, afterSeq: 5, text: 'continue' };
  const transcript = {
    messages: [{ role: 'assistant', text: 'old answer', seq: 4 }],
    turnEndSeq: 5,
  };
  assert.equal(resolvePendingReply(pending, transcript), pending);
});

test('follow-up waiting advances once then accepts turn end on the next poll', () => {
  const pending = { since: 1, afterSeq: 5, text: 'continue' };
  const sent = { messages: [{ role: 'user', text: 'continue', seq: 8 }] };
  const advanced = resolvePendingReply(pending, sent);
  assert.deepEqual(advanced, { ...pending, afterSeq: 8, userObserved: true });
  assert.ok(advanced);
  assert.equal(resolvePendingReply(advanced, { ...sent, turnEndSeq: 9 }), null);
});

test('an identical historical user message does not mark the new prompt as observed', () => {
  const pending = { since: 1, afterSeq: 5, text: 'continue' };
  const transcript = {
    messages: [{ role: 'user', text: 'continue', seq: 5 }],
    turnEndSeq: 6,
  };
  assert.equal(resolvePendingReply(pending, transcript), pending);
});

test('a durable assistant reply clears waiting regardless of turn end presence', () => {
  assert.equal(resolvePendingReply(
    { since: 1, afterSeq: 5, text: 'continue' },
    { messages: [{ role: 'user', text: 'continue', seq: 8 }, { role: 'assistant', text: 'done', seq: 9 }] },
  ), null);
});
