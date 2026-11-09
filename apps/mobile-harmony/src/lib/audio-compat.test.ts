import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioPlayer, AudioPlaylist } from 'expo-audio';

import { activateAudioLockScreen, audioStatusError, clearAudioLockScreen } from './audio-compat';

test('lock-screen compatibility is a no-op for SDK 55 playlists', () => {
  const playlist = {} as AudioPlaylist;
  assert.doesNotThrow(() => activateAudioLockScreen(playlist, { title: 'test' }));
  assert.doesNotThrow(() => clearAudioLockScreen(playlist));
});

test('lock-screen compatibility uses only SDK 55 options', () => {
  let activation: unknown[] | null = null;
  let cleared = false;
  const player = {
    setActiveForLockScreen(...args: unknown[]) { activation = args; },
    clearLockScreenControls() { cleared = true; },
  } as unknown as AudioPlayer;

  activateAudioLockScreen(player, { title: 'test' });
  clearAudioLockScreen(player);

  assert.deepEqual(activation, [
    true,
    { title: 'test' },
    { showSeekForward: false, showSeekBackward: false },
  ]);
  assert.equal(cleared, true);
});

test('audioStatusError tolerates SDK 55 statuses and reads SDK 58 errors', () => {
  assert.equal(audioStatusError({ playing: true }), null);
  assert.equal(audioStatusError({ error: '' }), null);
  assert.equal(audioStatusError({ error: 'playback failed' }), 'playback failed');
});
