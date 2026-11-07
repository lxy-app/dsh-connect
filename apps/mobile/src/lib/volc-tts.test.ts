import assert from 'node:assert/strict';
import test from 'node:test';

import { fromByteArray } from 'base64-js';

import {
  buildVolcTtsUrl,
  parseVolcTtsChunks,
  synthesizeVolcTts,
  VOLC_TTS_DEFAULT_VOICE,
  VOLC_TTS_RESOURCE_ID,
} from './volc-tts';

test('TTS URL appends the Agent Plan unidirectional path exactly once', () => {
  assert.equal(
    buildVolcTtsUrl('https://openspeech.bytedance.com/'),
    'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional',
  );
  const full = buildVolcTtsUrl('https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional');
  assert.equal(full, 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional');
});

test('TTS parser joins base64 audio chunks in order', () => {
  const body = [
    JSON.stringify({ code: 0, data: fromByteArray(new Uint8Array([1, 2])) }),
    JSON.stringify({ code: 0, data: fromByteArray(new Uint8Array([3, 4])) }),
    JSON.stringify({ code: 20000000 }),
  ].join('\n');
  assert.deepEqual([...parseVolcTtsChunks(body)], [1, 2, 3, 4]);
});

test('TTS parser rejects partial audio without a terminal success frame', () => {
  const body = JSON.stringify({ code: 0, data: fromByteArray(new Uint8Array([1, 2])) });
  assert.throws(() => parseVolcTtsChunks(body), /未返回完成标记/);
});

test('TTS parser preserves server errors and rejects empty successful audio', () => {
  assert.throws(() => parseVolcTtsChunks('{"code":45000000,"message":"denied"}'), /denied/);
  assert.throws(() => parseVolcTtsChunks('{"code":20000000}'), /未返回音频内容/);
});

test('TTS request uses Agent Plan headers, resource ID and configured voice', async () => {
  let requestedUrl = '';
  let headers: Record<string, string> = {};
  let requestBody = '';
  const responseBody = [
    JSON.stringify({ code: 0, data: fromByteArray(new Uint8Array([9, 8])) }),
    JSON.stringify({ code: 20000000 }),
  ].join('\n');
  const audio = await synthesizeVolcTts(
    { apiKey: 'secret-key', text: '你好' },
    async (input, init) => {
      requestedUrl = input;
      headers = init?.headers ?? {};
      requestBody = init?.body ?? '';
      return { ok: true, status: 200, text: async () => responseBody };
    },
  );

  assert.deepEqual([...audio], [9, 8]);
  assert.equal(requestedUrl, buildVolcTtsUrl());
  assert.equal(headers['X-Api-Key'], 'secret-key');
  assert.equal(headers['X-Api-Resource-Id'], VOLC_TTS_RESOURCE_ID);
  const parsed = JSON.parse(requestBody) as {
    model?: string;
    req_params: { text: string; speaker: string; audio_params: { format: string; sample_rate: number } };
  };
  assert.equal(parsed.model, undefined);
  assert.equal(parsed.req_params.text, '你好');
  assert.equal(parsed.req_params.speaker, VOLC_TTS_DEFAULT_VOICE);
  assert.deepEqual(parsed.req_params.audio_params, { format: 'mp3', sample_rate: 24000 });
  assert.equal(requestBody.includes('secret-key'), false);
});

test('TTS request forwards the selected non-default voice', async () => {
  let requestBody = '';
  const responseBody = [
    JSON.stringify({ code: 0, data: fromByteArray(new Uint8Array([7])) }),
    JSON.stringify({ code: 20000000 }),
  ].join('\n');
  await synthesizeVolcTts(
    { apiKey: 'secret-key', text: '你好', speaker: 'zh_female_vv_uranus_bigtts' },
    async (_input, init) => {
      requestBody = init?.body ?? '';
      return { ok: true, status: 200, text: async () => responseBody };
    },
  );

  const parsed = JSON.parse(requestBody) as { req_params: { speaker: string } };
  assert.equal(parsed.req_params.speaker, 'zh_female_vv_uranus_bigtts');
});
