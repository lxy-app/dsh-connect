export const TTS_CACHE_MAX_BYTES = 32 * 1024 * 1024;
export const TTS_CACHE_MAX_FILES = 100;

export type TtsCacheKeyInput = {
  text: string;
  speaker: string;
  endpoint: string;
  resourceId: string;
  format?: 'mp3' | 'pcm';
  sampleRate?: number;
};

/** Stable, non-secret cache identity. Playback rate is applied by the player. */
export function buildTtsCacheKey(input: TtsCacheKeyInput): string {
  const value = JSON.stringify({
    version: 1,
    text: input.text,
    speaker: input.speaker,
    endpoint: input.endpoint.trim().replace(/\/+$/, ''),
    resourceId: input.resourceId,
    format: input.format ?? 'mp3',
    sampleRate: input.sampleRate ?? 24_000,
  });
  return `${fnv1a(value, 0x811c9dc5)}${fnv1a(value, 0x01000193)}-${input.text.length.toString(16)}`;
}

export type TtsCacheEntry = {
  uri: string;
  size: number;
  modifiedAt: number;
};

/** Return oldest entries beyond the byte/file budgets, always protecting active output. */
export function selectTtsCacheEvictions(
  entries: TtsCacheEntry[],
  protectedUris: readonly string[] = [],
): TtsCacheEntry[] {
  const ordered = [...entries].sort((left, right) => right.modifiedAt - left.modifiedAt);
  const evictions: TtsCacheEntry[] = [];
  const protectedSet = new Set(protectedUris);
  const protectedEntries = entries.filter((entry) => protectedSet.has(entry.uri));
  let retainedBytes = protectedEntries.reduce((total, entry) => total + entry.size, 0);
  let retainedFiles = protectedEntries.length;
  for (const entry of ordered) {
    if (protectedSet.has(entry.uri)) continue;
    if (retainedFiles >= TTS_CACHE_MAX_FILES || retainedBytes + entry.size > TTS_CACHE_MAX_BYTES) {
      evictions.push(entry);
      continue;
    }
    retainedFiles += 1;
    retainedBytes += entry.size;
  }
  return evictions;
}

function fnv1a(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash ^= code & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= code >>> 8;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
