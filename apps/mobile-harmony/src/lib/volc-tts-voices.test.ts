import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getVolcTtsVoice,
  isVolcTtsVoiceId,
  normalizeVolcTtsVoice,
  VOLC_TTS_DEFAULT_VOICE,
  VOLC_TTS_VOICES,
} from './volc-tts-voices';

test('TTS voice catalog has unique selectable IDs and contains the default voice', () => {
  const ids = VOLC_TTS_VOICES.map((voice) => voice.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(isVolcTtsVoiceId(VOLC_TTS_DEFAULT_VOICE), true);
  assert.equal(getVolcTtsVoice(VOLC_TTS_DEFAULT_VOICE).name, '高冷御姐');
});

test('TTS voice normalization accepts every catalog entry and trims stored values', () => {
  for (const voice of VOLC_TTS_VOICES) {
    assert.equal(normalizeVolcTtsVoice(voice.id), voice.id);
    assert.equal(normalizeVolcTtsVoice(` ${voice.id} `), voice.id);
    assert.equal(getVolcTtsVoice(voice.id), voice);
  }
});

test('TTS voice normalization falls back for removed or custom voice IDs', () => {
  for (const value of ['', 'system', 'custom_voice', null, undefined, 1]) {
    assert.equal(normalizeVolcTtsVoice(value), VOLC_TTS_DEFAULT_VOICE);
  }
  assert.equal(isVolcTtsVoiceId('custom_voice'), false);
});
