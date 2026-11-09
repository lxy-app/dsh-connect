import assert from 'node:assert/strict';
import test from 'node:test';

import { SystemVoiceSessionGuard } from './system-voice-session';

test('cancelled system ASR blocks restart until its terminal end is consumed', () => {
  const guard = new SystemVoiceSessionGuard();
  guard.beginClosing();
  assert.equal(guard.canStart(), false);
  assert.equal(guard.isClosing(), true);
  assert.equal(guard.consumeTerminalEnd(), true);
  assert.equal(guard.canStart(), true);
});

test('terminal end is consumed once and normal recording can finish independently', () => {
  const guard = new SystemVoiceSessionGuard();
  guard.beginClosing();
  assert.equal(guard.consumeTerminalEnd(), true);
  assert.equal(guard.consumeTerminalEnd(), false);
  assert.equal(guard.canStart(), true);
  assert.equal(guard.consumeTerminalEnd(), false);
});
