import assert from 'node:assert/strict';
import test from 'node:test';

import { FIRST_SPEECH_SEGMENT_MAX, SPEECH_SEGMENT_MAX, splitTextForSpeech } from '@shared/lib/speech-segments';

test('empty and short speech text need no segmentation', () => {
  assert.deepEqual(splitTextForSpeech('  \n'), []);
  assert.deepEqual(splitTextForSpeech('你好，世界。'), ['你好，世界。']);
});

test('sentence boundaries are preserved and the first segment is bounded for fast playback', () => {
  const input = `${'第一句很长，'.repeat(30)}。第二句！\n第三句？`;
  const segments = splitTextForSpeech(input);
  assert.ok(segments.length > 1);
  assert.ok(segments[0]!.length <= FIRST_SPEECH_SEGMENT_MAX);
  assert.ok(segments.every((segment) => segment.length <= SPEECH_SEGMENT_MAX));
  assert.equal(segments.join('').replace(/\s/g, ''), input.replace(/\s/g, ''));
});

test('long unseparated text is bounded without losing content', () => {
  const input = '汉'.repeat(500);
  const segments = splitTextForSpeech(input);
  assert.equal(segments[0]!.length, FIRST_SPEECH_SEGMENT_MAX);
  assert.ok(segments.every((segment) => segment.length <= SPEECH_SEGMENT_MAX));
  assert.equal(segments.join(''), input);
});

test('English text prefers word boundaries', () => {
  const segments = splitTextForSpeech('word '.repeat(100));
  assert.ok(segments.length > 1);
  assert.ok(segments.every((segment) => !segment.endsWith('wor') && segment.length <= SPEECH_SEGMENT_MAX));
  assert.equal(segments.join(' ').replace(/\s+/g, ' ').trim(), 'word '.repeat(100).trim());
});
