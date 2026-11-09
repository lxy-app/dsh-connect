import assert from 'node:assert/strict';
import test from 'node:test';

import { pcm16LeToFloat32, PcmStreamChunker, PCM_STREAM_BUFFER_BYTES, wrapPcmInWav } from '@shared/lib/pcm-stream';

test('PCM chunker preserves sample alignment and emits bounded buffers', () => {
  const chunker = new PcmStreamChunker();
  const input = new Uint8Array(PCM_STREAM_BUFFER_BYTES * 2 + 4).map((_, index) => index % 255);
  const first = chunker.push(input.slice(0, 1));
  assert.equal(first.length, 0);
  const chunks = chunker.push(input.slice(1));
  assert.deepEqual(chunks.map((chunk) => chunk.byteLength), [PCM_STREAM_BUFFER_BYTES, PCM_STREAM_BUFFER_BYTES, 4]);
  assert.equal(chunks[0]![0], 0);
  assert.equal(chunks[0]![1], 1);
  assert.equal(chunker.flush(), null);
});

test('PCM chunker rejects a terminal half sample', () => {
  const chunker = new PcmStreamChunker();
  chunker.push(new Uint8Array([1]));
  assert.throws(() => chunker.flush(), /半个采样/);
});

test('signed little-endian PCM converts to normalized float samples', () => {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setInt16(0, -32768, true);
  view.setInt16(2, 0, true);
  view.setInt16(4, 16384, true);
  view.setInt16(6, 32767, true);
  const samples = pcm16LeToFloat32(bytes);
  assert.deepEqual([...samples.slice(0, 3)], [-1, 0, 0.5]);
  assert.equal(samples[3], 32767 / 32768);
  assert.throws(() => pcm16LeToFloat32(new Uint8Array(1)), /偶数/);
});

test('WAV wrapper preserves PCM payload and writes a valid little-endian header', () => {
  const pcm = new Uint8Array([1, 2, 3, 4]);
  const wav = wrapPcmInWav(pcm);
  const view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), pcm.byteLength);
  assert.deepEqual([...wav.slice(44)], [...pcm]);
});
