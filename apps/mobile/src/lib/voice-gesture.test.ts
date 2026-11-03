import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldCancelVoiceGesture, VOICE_CANCEL_DISTANCE_PX } from './voice-gesture';

test('voice gesture arms cancellation only after moving above the threshold', () => {
  const startY = 500;
  assert.equal(shouldCancelVoiceGesture(startY, startY), false);
  assert.equal(shouldCancelVoiceGesture(startY, startY - VOICE_CANCEL_DISTANCE_PX), false);
  assert.equal(shouldCancelVoiceGesture(startY, startY - VOICE_CANCEL_DISTANCE_PX - 1), true);
});

test('voice gesture can return to the release-to-finish region', () => {
  const startY = 500;
  assert.equal(shouldCancelVoiceGesture(startY, startY - 100), true);
  assert.equal(shouldCancelVoiceGesture(startY, startY - 20), false);
  assert.equal(shouldCancelVoiceGesture(startY, startY + 80), false);
});
