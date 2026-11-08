import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTtsCacheKey,
  selectTtsCacheEvictions,
  TTS_CACHE_MAX_BYTES,
  TTS_CACHE_MAX_FILES,
  type TtsCacheEntry,
} from './tts-cache-policy';

const INPUT = {
  text: '需要朗读的文本',
  speaker: 'voice-a',
  endpoint: 'https://openspeech.bytedance.com/',
  resourceId: 'seed-tts-2.0',
};

test('TTS cache keys are stable and vary by spoken content and voice', () => {
  assert.equal(buildTtsCacheKey(INPUT), buildTtsCacheKey({ ...INPUT, endpoint: 'https://openspeech.bytedance.com' }));
  assert.notEqual(buildTtsCacheKey(INPUT), buildTtsCacheKey({ ...INPUT, text: '另一段文本' }));
  assert.notEqual(buildTtsCacheKey(INPUT), buildTtsCacheKey({ ...INPUT, speaker: 'voice-b' }));
});

test('cache eviction keeps newest entries within the byte budget', () => {
  const entries: TtsCacheEntry[] = [
    { uri: 'old', size: TTS_CACHE_MAX_BYTES - 1, modifiedAt: 1 },
    { uri: 'new', size: 2, modifiedAt: 2 },
  ];
  assert.deepEqual(selectTtsCacheEvictions(entries).map((entry) => entry.uri), ['old']);
});

test('cache eviction enforces file count and protects the newly written file', () => {
  const entries = Array.from({ length: TTS_CACHE_MAX_FILES + 1 }, (_, index) => ({
    uri: `file-${index}`,
    size: 1,
    modifiedAt: index,
  }));
  const evicted = selectTtsCacheEvictions(entries, ['file-0']);
  assert.equal(evicted.some((entry) => entry.uri === 'file-0'), false);
  assert.equal(evicted.some((entry) => entry.uri === 'file-1'), true);
  assert.equal(evicted.length, 1);
});

test('cross-generation cleanup protects both current and next active segments', () => {
  const entries: TtsCacheEntry[] = [
    { uri: 'old-generation', size: TTS_CACHE_MAX_BYTES, modifiedAt: 3 },
    { uri: 'current', size: 2, modifiedAt: 2 },
    { uri: 'next', size: 2, modifiedAt: 1 },
  ];
  const evicted = selectTtsCacheEvictions(entries, ['current', 'next']);
  assert.deepEqual(evicted.map((entry) => entry.uri), ['old-generation']);
});
