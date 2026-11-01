import assert from 'node:assert/strict';
import test from 'node:test';
import { CursorJournal } from '../src/lib/cursor-journal.js';

test('accepts ordered events and de-duplicates replay', () => {
  const journal = new CursorJournal();
  assert.equal(journal.accept('session-a', 1), true);
  assert.equal(journal.accept('session-a', 2), true);
  assert.equal(journal.accept('session-a', 2), false);
  assert.equal(journal.accept('session-a', 1), false);
  assert.equal(journal.cursor('session-a'), 2);
});

test('a durable sequence gap requires snapshot recovery', () => {
  const journal = new CursorJournal({ 'session-a': 4 });
  assert.throws(() => journal.accept('session-a', 6), { code: 'event_sequence_gap', retryable: true });
  assert.equal(journal.cursor('session-a'), 4);
  const initial = new CursorJournal();
  assert.throws(() => initial.accept('session-b', 3), { code: 'event_sequence_gap' });
});

test('snapshot reset establishes a recovery baseline', () => {
  const journal = new CursorJournal({ 'session-a': 9 });
  journal.reset('session-a', 12);
  assert.equal(journal.cursor('session-a'), 12);
  assert.equal(journal.accept('session-a', 13), true);
  assert.deepEqual(journal.toJSON(), { 'session-a': 13 });
});
