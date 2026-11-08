import { Directory, File, Paths } from 'expo-file-system';

import { KeyedPublishQueue } from '@/lib/keyed-publish-queue';
import { buildTtsCacheKey, selectTtsCacheEvictions } from '@/lib/tts-cache-policy';
import {
  synthesizeVolcTts,
  VOLC_TTS_DEFAULT_ENDPOINT,
  VOLC_TTS_DEFAULT_VOICE,
  VOLC_TTS_RESOURCE_ID,
  type VolcTtsOptions,
} from '@/lib/volc-tts';

const CACHE_DIRECTORY_NAME = 'dsh-tts-v1';
const PUBLICATIONS = new KeyedPublishQueue<File>();
let temporaryFileSequence = 0;
let activeCacheScope: { owner: number; uris: Set<string> } | null = null;

export type ResolvedVolcTtsSegment = {
  file: File;
  cacheHit: boolean;
};

type VolcTtsCacheIdentity = {
  text: string;
  speaker?: string;
  endpoint?: string;
  format?: 'mp3' | 'pcm';
};

export async function resolveVolcTtsSegment(options: VolcTtsOptions): Promise<ResolvedVolcTtsSegment> {
  const key = cacheKey(options);
  cacheDirectory().create({ intermediates: true, idempotent: true });
  const file = cacheFile(key);
  if (file.exists && file.size > 0) return { file, cacheHit: true };
  if (file.exists) file.delete();

  // An older playback may already be publishing this segment. Await that
  // complete file instead of reading a partial destination or synthesizing twice.
  const pending = PUBLICATIONS.get(key);
  if (pending) return { file: await pending, cacheHit: true };

  const audio = await synthesizeVolcTts(options);
  const published = await PUBLICATIONS.run(key, () => publishAtomically(key, file, audio));
  return { file: published, cacheHit: false };
}

export function activateVolcTtsCacheScope(owner: number, identities: VolcTtsCacheIdentity[]): void {
  activeCacheScope = {
    owner,
    uris: new Set(identities.map((identity) => cacheFile(cacheKey(identity), identity.format ?? 'mp3').uri)),
  };
}

export function releaseVolcTtsCacheScope(owner: number | null): void {
  if (owner === null || activeCacheScope?.owner !== owner) return;
  activeCacheScope = null;
  try {
    pruneCache();
  } catch {
    // A later publication will retry maintenance.
  }
}

export function invalidateVolcTtsSegment(options: VolcTtsCacheIdentity): void {
  const file = cacheFile(cacheKey(options), options.format ?? 'mp3');
  if (file.exists) file.delete();
}

export async function readCachedVolcPcm(options: VolcTtsCacheIdentity): Promise<Uint8Array | null> {
  const key = cacheKey({ ...options, format: 'pcm' });
  const file = cacheFile(key, 'pcm');
  if (!file.exists) {
    // A short reply may finish playing before its atomic cache publication ends.
    // Join that same-key write instead of starting another paid WS synthesis.
    const pending = PUBLICATIONS.get(key);
    if (!pending) return null;
    try {
      await pending;
    } catch {
      return null;
    }
  }
  if (!file.exists || file.size <= 0) return null;
  if (file.size % 2 !== 0 || file.size > 64 * 1024 * 1024) {
    file.delete();
    return null;
  }
  return file.bytes();
}

export async function publishVolcPcm(options: VolcTtsCacheIdentity, audio: Uint8Array): Promise<File> {
  if (audio.byteLength === 0) throw new Error('不缓存空 PCM 音频。');
  cacheDirectory().create({ intermediates: true, idempotent: true });
  const key = cacheKey({ ...options, format: 'pcm' });
  const file = cacheFile(key, 'pcm');
  return PUBLICATIONS.run(key, () => publishAtomically(key, file, audio));
}

async function publishAtomically(key: string, destination: File, audio: Uint8Array): Promise<File> {
  const temporary = new File(
    cacheDirectory(),
    `${key}.${Date.now()}-${++temporaryFileSequence}.tmp`,
  );
  const temporaryUri = temporary.uri;
  try {
    await temporary.write(audio);
    // The final key appears only after a complete same-directory move. Overwrite
    // also handles a file left by an earlier process without exposing partial bytes.
    await temporary.move(destination, { overwrite: true });
    try {
      pruneCache();
    } catch {
      // A complete, playable file must not fail because maintenance failed.
    }
    return destination;
  } finally {
    const leftover = new File(temporaryUri);
    if (leftover.exists) leftover.delete();
  }
}

function cacheKey(options: VolcTtsCacheIdentity): string {
  return buildTtsCacheKey({
    text: options.text.trim(),
    speaker: options.speaker?.trim() || VOLC_TTS_DEFAULT_VOICE,
    endpoint: options.endpoint ?? VOLC_TTS_DEFAULT_ENDPOINT,
    resourceId: VOLC_TTS_RESOURCE_ID,
    format: options.format,
  });
}

function cacheDirectory(): Directory {
  // Expo Router evaluates modules with expo-file-system's Web stub during
  // server/static export, including for a native Release build. Construct native
  // paths only when a real cache operation runs, never during module evaluation.
  return new Directory(Paths.cache, CACHE_DIRECTORY_NAME);
}

function cacheFile(key: string, format: 'mp3' | 'pcm' = 'mp3'): File {
  return new File(cacheDirectory(), `${key}.${format}`);
}

function pruneCache(): void {
  const directory = cacheDirectory();
  if (!directory.exists) return;
  const protectedUris = activeCacheScope ? [...activeCacheScope.uris] : [];
  const entries = directory.list()
    .filter((item): item is File => item instanceof File && (item.extension === '.mp3' || item.extension === '.pcm') && item.exists)
    .map((file) => ({
      uri: file.uri,
      size: Math.max(0, file.size),
      modifiedAt: file.lastModified ?? file.creationTime ?? 0,
    }));
  for (const entry of selectTtsCacheEvictions(entries, protectedUris)) {
    const file = new File(entry.uri);
    if (file.exists) file.delete();
  }
}
