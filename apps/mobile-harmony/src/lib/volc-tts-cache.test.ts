import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';

import { KeyedPublishQueue } from '@shared/lib/keyed-publish-queue';
import { buildTtsCacheKey, selectTtsCacheEvictions } from '@shared/lib/tts-cache-policy';

// Run the platform cache with a controlled filesystem without loading RN native modules in Node.
function createCacheHarness() {
  const files = new Map<string, Uint8Array>();
  let releaseWrite: (() => void) | undefined;
  let writeStarted: (() => void) | undefined;
  const writing = new Promise<void>((resolve) => { writeStarted = resolve; });
  const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
  let writes = 0;
  let moves = 0;
  class Directory {
    readonly uri = 'cache/dsh-tts-v1';
    readonly exists = true;
    create() {}
    list() { return []; }
  }
  class File {
    readonly uri: string;
    constructor(parent: Directory | string, name?: string) {
      this.uri = typeof parent === 'string' ? parent : `${parent.uri}/${name}`;
    }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.byteLength ?? 0; }
    delete() { files.delete(this.uri); }
    async write(audio: Uint8Array) {
      writes++;
      writeStarted?.();
      await writeGate;
      files.set(this.uri, audio);
    }
    async bytes() { return files.get(this.uri) ?? new Uint8Array(); }
  }
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'volc-tts-cache.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  const modules: Record<string, unknown> = {
    'expo-file-system': { Directory, File, Paths: { cache: 'cache' } },
    'expo-file-system/legacy': { moveAsync: async ({ from, to }: { from: string; to: string }) => {
      moves++;
      const data = files.get(from);
      if (data) files.set(to, data);
      files.delete(from);
    } },
    '@shared/lib/keyed-publish-queue': { KeyedPublishQueue },
    '@shared/lib/tts-cache-policy': { buildTtsCacheKey, selectTtsCacheEvictions },
    '@/lib/volc-tts': {
      synthesizeVolcTts: async () => new Uint8Array([1, 2]),
      VOLC_TTS_DEFAULT_ENDPOINT: 'https://openspeech.bytedance.com',
      VOLC_TTS_DEFAULT_VOICE: 'voice',
      VOLC_TTS_RESOURCE_ID: 'seed-tts-2.0',
    },
  };
  runInNewContext(compiled, { exports, require: (id: string) => {
    if (!(id in modules)) throw new Error(`Unexpected import: ${id}`);
    return modules[id];
  }, Uint8Array, Date, Set, Promise, Error });
  return {
    resolve: exports.resolveVolcTtsSegment as (options: { text: string; apiKey: string; signal?: AbortSignal }) => Promise<{ file: File; cacheHit: boolean }>,
    writing,
    releaseWrite: () => releaseWrite?.(),
    get writes() { return writes; },
    get moves() { return moves; },
  };
}

test('aborting one same-key waiter does not cancel the shared cache publication', async () => {
  const cache = createCacheHarness();
  const options = { apiKey: 'secret', text: 'same segment' };
  const publisher = cache.resolve(options);
  await cache.writing;
  const cancelled = new AbortController();
  const waiter = cache.resolve({ ...options, signal: cancelled.signal });
  const survivor = cache.resolve(options);
  cancelled.abort();
  await assert.rejects(waiter, (error: Error) => error.name === 'AbortError');
  assert.equal(cache.moves, 0, 'cancelled waiter must not publish or interrupt unfinished write');
  cache.releaseWrite();
  const [published, reused] = await Promise.all([publisher, survivor]);
  assert.equal(published.cacheHit, false);
  assert.equal(reused.cacheHit, true);
  assert.equal(reused.file.uri, published.file.uri);
  assert.equal(cache.writes, 1);
  assert.equal(cache.moves, 1);
});

test('already-aborted waiter rejects immediately while publisher finishes', async () => {
  const cache = createCacheHarness();
  const options = { apiKey: 'secret', text: 'another segment' };
  const publisher = cache.resolve(options);
  await cache.writing;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cache.resolve({ ...options, signal: controller.signal }), (error: Error) => error.name === 'AbortError');
  cache.releaseWrite();
  assert.equal((await publisher).cacheHit, false);
  assert.equal(cache.moves, 1);
});
