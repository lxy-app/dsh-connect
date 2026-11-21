'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { patchExpoAudioRouting } = require('./patch-audio-routing');

const UPSTREAM = `    const routeChanged: boolean = (next.shouldRouteThroughEarpiece === true) !== (this.mode.shouldRouteThroughEarpiece === true);

    if (deviceInfo.sdkApiVersion >= 20) {
      const earpiece = next.shouldRouteThroughEarpiece === true;

      this.sessionManager.setAudioSessionScene(
        earpiece ? audio.AudioSessionScene.AUDIO_SESSION_SCENE_VOICE_COMMUNICATION : audio.AudioSessionScene.AUDIO_SESSION_SCENE_MEDIA,
      );

      await this.sessionManager.setDefaultOutputDevice(earpiece ? audio.DeviceType.EARPIECE : audio.DeviceType.DEFAULT);
    } else if (next.shouldRouteThroughEarpiece === true) {
      throw new ExpoAudioError('ERR_AUDIO_EARPIECE_ROUTING_UNSUPPORTED', 'Routing playback through the earpiece requires HarmonyOS API 20 or newer.');
    }
`;

test('ordinary audio-mode writes do not invoke output routing', () => {
  const result = patchExpoAudioRouting(UPSTREAM);
  assert.equal(result.changed, true);
  assert.match(result.source, /if \(routeChanged && deviceInfo\.sdkApiVersion >= 20\)/);
  assert.match(result.source, /else if \(routeChanged && next\.shouldRouteThroughEarpiece === true\)/);
  assert.doesNotMatch(result.source, /if \(deviceInfo\.sdkApiVersion >= 20\)/);
  assert.doesNotMatch(result.source, /else if \(next\.shouldRouteThroughEarpiece === true\)/);
});

test('routing patch is idempotent', () => {
  const once = patchExpoAudioRouting(UPSTREAM);
  const twice = patchExpoAudioRouting(once.source);
  assert.equal(twice.changed, false);
  assert.equal(twice.source, once.source);
});

test('partial or changed upstream implementations fail closed', () => {
  assert.throws(
    () => patchExpoAudioRouting(UPSTREAM.replace('deviceInfo.sdkApiVersion >= 20', 'routeChanged && deviceInfo.sdkApiVersion >= 20')),
    /incomplete/,
  );
  assert.throws(() => patchExpoAudioRouting('const unrelated = true;'), /Unexpected expo-audio/);
});
