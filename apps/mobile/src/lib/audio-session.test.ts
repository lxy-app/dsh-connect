import assert from 'node:assert/strict';
import test from 'node:test';

import { PLAYBACK_AUDIO_MODE, RECORDING_AUDIO_MODE } from './audio-session';

test('playback mode keeps cloud audio active in background without recording', () => {
  assert.equal(PLAYBACK_AUDIO_MODE.allowsRecording, false);
  assert.equal(PLAYBACK_AUDIO_MODE.allowsBackgroundRecording, false);
  assert.equal(PLAYBACK_AUDIO_MODE.shouldPlayInBackground, true);
  assert.equal(PLAYBACK_AUDIO_MODE.playsInSilentMode, true);
  assert.equal(PLAYBACK_AUDIO_MODE.interruptionMode, 'doNotMix');
});

test('recording mode never leaves background recording or playback enabled', () => {
  assert.equal(RECORDING_AUDIO_MODE.allowsRecording, true);
  assert.equal(RECORDING_AUDIO_MODE.allowsBackgroundRecording, false);
  assert.equal(RECORDING_AUDIO_MODE.shouldPlayInBackground, false);
  assert.equal(RECORDING_AUDIO_MODE.interruptionMode, 'doNotMix');
});
