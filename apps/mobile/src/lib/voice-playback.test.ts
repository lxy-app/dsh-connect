import assert from 'node:assert/strict';
import test from 'node:test';

import { voiceControlAction, voicePlaybackStatusFromAudio, type VoicePlayback } from './voice-playback';

function playback(status: VoicePlayback['status'], canPause = true): VoicePlayback {
  return { key: 'turn-1', status, provider: 'volcengine', canPause };
}

test('idle and a different message start a new playback', () => {
  assert.equal(voiceControlAction(null, 'turn-1'), 'start');
  assert.equal(voiceControlAction(playback('playing'), 'turn-2'), 'start');
});

test('preparing playback can be cancelled instead of queued again', () => {
  assert.equal(voiceControlAction(playback('preparing'), 'turn-1'), 'cancel');
});

test('cloud playback toggles between pause and resume', () => {
  assert.equal(voiceControlAction(playback('playing'), 'turn-1'), 'pause');
  assert.equal(voiceControlAction(playback('paused'), 'turn-1'), 'resume');
});

test('Android system TTS exposes stop when pause is unavailable', () => {
  assert.equal(voiceControlAction(playback('playing', false), 'turn-1'), 'stop');
});

test('audio waiting does not look like a user pause', () => {
  const waiting = { playing: false, timeControlStatus: 'waitingToPlayAtSpecifiedRate' };
  assert.equal(voicePlaybackStatusFromAudio(waiting, 'playing'), null);
  assert.equal(voicePlaybackStatusFromAudio(waiting, 'preparing'), null);
});

test('only explicit paused events pause active playback', () => {
  const paused = { playing: false, timeControlStatus: 'paused' };
  assert.equal(voicePlaybackStatusFromAudio(paused, 'playing'), 'paused');
  assert.equal(voicePlaybackStatusFromAudio(paused, 'preparing'), null);
  assert.equal(voicePlaybackStatusFromAudio({ playing: true, timeControlStatus: 'playing' }, 'paused'), 'playing');
});
