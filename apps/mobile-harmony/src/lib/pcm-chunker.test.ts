import assert from 'node:assert/strict';
import test from 'node:test';

import { PcmChunker } from './pcm-chunker';

test('PCM chunker aggregates native buffers and preserves their order', () => {
  const chunker = new PcmChunker(4);
  assert.deepEqual(chunker.push(new Uint8Array([1, 2, 3])), []);
  assert.deepEqual(chunker.push(new Uint8Array([4, 5, 6, 7, 8])).map((chunk) => [...chunk]), [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
  ]);
  assert.equal(chunker.flush(), null);
});

test('PCM chunker flushes a partial final packet once', () => {
  const chunker = new PcmChunker(4);
  chunker.push(new Uint8Array([1]));
  chunker.push(new Uint8Array([2, 3]));
  assert.deepEqual([...(chunker.flush() ?? [])], [1, 2, 3]);
  assert.equal(chunker.flush(), null);
});

test('PCM chunker rejects invalid packet sizes and can reset partial data', () => {
  assert.throws(() => new PcmChunker(3));
  const chunker = new PcmChunker(4);
  chunker.push(new Uint8Array([1, 2]));
  chunker.reset();
  assert.equal(chunker.flush(), null);
});
