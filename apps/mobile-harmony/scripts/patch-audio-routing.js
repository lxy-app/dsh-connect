'use strict';

const fs = require('node:fs');

const ORIGINAL_SCENE_CONDITION = `    if (deviceInfo.sdkApiVersion >= 20) {
      const earpiece = next.shouldRouteThroughEarpiece === true;`;
const PATCHED_SCENE_CONDITION = `    if (routeChanged && deviceInfo.sdkApiVersion >= 20) {
      const earpiece = next.shouldRouteThroughEarpiece === true;`;
const ORIGINAL_ROUTE_FALLBACK = '    } else if (next.shouldRouteThroughEarpiece === true) {';
const PATCHED_ROUTE_FALLBACK = '    } else if (routeChanged && next.shouldRouteThroughEarpiece === true) {';

/**
 * @expo-harmony/expo-audio@55.0.18-harmony.4 routes every audio-mode write
 * through setAudioSessionScene/setDefaultOutputDevice. On XYAO-W00 that
 * unsolicited DEFAULT route fails with "System error", before ASR capture or
 * TTS playback can start. Only an actual earpiece/speaker change needs it.
 */
function patchExpoAudioRouting(source) {
  const hasScenePatch = source.includes(PATCHED_SCENE_CONDITION);
  const hasFallbackPatch = source.includes(PATCHED_ROUTE_FALLBACK);
  if (hasScenePatch && hasFallbackPatch) return { source, changed: false };
  if (hasScenePatch || hasFallbackPatch) {
    throw new Error('expo-audio routing patch is incomplete; inspect the upstream implementation.');
  }
  if (!source.includes(ORIGINAL_SCENE_CONDITION) || !source.includes(ORIGINAL_ROUTE_FALLBACK)) {
    throw new Error('Unexpected expo-audio setAudioMode implementation; update the routing patch explicitly.');
  }
  return {
    source: source.replace(ORIGINAL_SCENE_CONDITION, PATCHED_SCENE_CONDITION).replace(ORIGINAL_ROUTE_FALLBACK, PATCHED_ROUTE_FALLBACK),
    changed: true,
  };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node patch-audio-routing.js <ExpoAudioPackage.ets>');
  const result = patchExpoAudioRouting(fs.readFileSync(file, 'utf8'));
  if (result.changed) {
    fs.writeFileSync(file, result.source);
    console.log(`[patch] ${file}: audio route changes are now conditional`);
  }
}

module.exports = { patchExpoAudioRouting };
