import { Directory, File, Paths } from 'expo-file-system';
import { moveAsync } from 'expo-file-system/legacy';

import { buildAttachmentUrl, MobileApiError } from '@/lib/mobile-api';
import {
  attachmentDocumentRetryDelayMs,
  normalizeAttachmentDocumentETag,
  parseAttachmentDocumentPending,
  type AttachmentDocumentPending,
} from '@/lib/attachment-documents';
import type { MobileAttachment } from '@shared/types/mobile';

const CACHE_DIRECTORY_NAME = 'dsh-attachment-originals-v1';
const REQUEST_TIMEOUT_MS = 30_000;
const ORIGINAL_MAX_BYTES = 20 * 1024 * 1024;
const activePublications = new Set<Promise<File>>();
let cacheGeneration = 0;
let temporaryFileSequence = 0;

export type OriginalFileAuth = {
  readonly serverUrl: string;
  readonly accessToken: string;
};

export type DownloadedOriginalFile = {
  readonly file: File;
  readonly attachment: MobileAttachment;
};

/**
 * Downloads the original attachment bytes (not the PDF preview derivative).
 * Revalidates any cached copy with If-None-Match before serving it.
 */
export async function downloadOriginalFile(
  attachment: MobileAttachment,
  auth: OriginalFileAuth,
  options: {
    readonly signal: AbortSignal;
    readonly onPending?: (pending: AttachmentDocumentPending, attempt: number) => void;
  },
): Promise<DownloadedOriginalFile> {
  if (!/^att_[A-Za-z0-9_-]{8,64}$/.test(attachment.attachmentId)) {
    throw new MobileApiError('invalid_id', '附件标识无效。', 400);
  }
  const url = buildAttachmentUrl(auth.serverUrl, attachment.attachmentId);
  const key = originalCacheKey(attachment, auth.serverUrl);
  const generation = cacheGeneration;
  const destination = new File(cacheDirectory(), `${key}.original`);
  throwIfCancelled(options.signal, generation);

  const cached = readValidCache(destination, attachment, options.signal, generation);
  const cachedETag = cached ? readCachedETag(key, attachment) : null;

  cacheDirectory().create({ intermediates: true, idempotent: true });
  const startedAt = Date.now();
  let attempt = 1;
  while (true) {
    throwIfCancelled(options.signal, generation);
    const outcome = await requestOriginal(url, auth.accessToken, options.signal, cachedETag);
    throwIfCancelled(options.signal, generation);
    if (outcome.kind === 'pending') {
      const delayMs = attachmentDocumentRetryDelayMs(outcome.pending, attempt, Date.now() - startedAt);
      if (delayMs === null) {
        throw new MobileApiError('timeout', '等待附件超过 2 分钟，请稍后手动重试。', 202, true);
      }
      options.onPending?.(outcome.pending, attempt);
      await abortableDelay(delayMs, options.signal);
      attempt += 1;
      continue;
    }

    if (outcome.kind === 'notModified') {
      const validCached = cached
        ? readValidCache(cached, attachment, options.signal, generation)
        : null;
      if (!validCached) {
        throw new MobileApiError('cache_cleared', '缓存已变化，请重新下载。', 304, true);
      }
      throwIfCancelled(options.signal, generation);
      return { file: validCached, attachment };
    }

    validateDownloadedBytes(outcome.bytes, attachment);
    throwIfCancelled(options.signal, generation);
    let published: File;
    try {
      published = await publishAtomically(key, destination, outcome.bytes);
    } catch (error) {
      throwIfCancelled(options.signal, generation);
      throw error;
    }
    throwIfCancelled(options.signal, generation);
    writeCachedETag(key, outcome.etag);
    throwIfCancelled(options.signal, generation);
    return { file: published, attachment };
  }
}

/** Clears only the original-file cache, never the document or image cache. */
export async function clearOriginalFileCache(): Promise<void> {
  cacheGeneration += 1;
  await Promise.allSettled([...activePublications]);
  const directory = cacheDirectory();
  if (directory.exists) directory.delete();
}

export function isOriginalFileAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function originalCacheKey(attachment: MobileAttachment, serverUrl: string): string {
  const hash = stableHash(serverUrl.replace(/\/+$/, ''));
  return `server-${hash}-id-${attachment.attachmentId}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function readValidCache(
  file: File,
  attachment: MobileAttachment,
  signal: AbortSignal,
  generation: number,
): File | null {
  if (!file.exists) return null;
  try {
    if (file.size > ORIGINAL_MAX_BYTES) {
      discardFile(file);
      return null;
    }
    const valid = Number.isSafeInteger(attachment.bytes)
      && attachment.bytes >= 0
      && file.size === attachment.bytes;
    throwIfCancelled(signal, generation);
    if (valid) return file;
  } catch (error) {
    if (isOriginalFileAbortError(error)) throw error;
    throwIfCancelled(signal, generation);
  }
  throwIfCancelled(signal, generation);
  discardFile(file);
  return null;
}

function validateDownloadedBytes(bytes: Uint8Array, attachment: MobileAttachment): void {
  if (bytes.byteLength > ORIGINAL_MAX_BYTES) {
    throw new MobileApiError('payload_too_large', '附件超过 20 MB，无法下载。', 413);
  }
  if (
    Number.isSafeInteger(attachment.bytes)
    && attachment.bytes >= 0
    && bytes.byteLength !== attachment.bytes
  ) {
    throw new MobileApiError('bytes_mismatch', '附件大小与记录不一致，请重试。', 200, true);
  }
}

function readCachedETag(key: string, attachment: MobileAttachment): string | null {
  try {
    const file = new File(cacheDirectory(), `${key}.etag`);
    if (file.exists) {
      const etag = normalizeAttachmentDocumentETag(file.textSync());
      if (etag) return etag;
    }
  } catch {
    // Invalid metadata forces an authorized full download instead of cache use.
  }
  const sha256 = attachment.sha256?.toLowerCase();
  return sha256 && /^[a-f0-9]{64}$/.test(sha256) ? `"${sha256}"` : null;
}

function writeCachedETag(key: string, etag: string | null): void {
  const file = new File(cacheDirectory(), `${key}.etag`);
  if (!etag) {
    discardFile(file);
    return;
  }
  try {
    file.write(etag);
  } catch {
    discardFile(file);
  }
}

type RequestOutcome =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly etag: string | null }
  | { readonly kind: 'notModified' }
  | { readonly kind: 'pending'; readonly pending: AttachmentDocumentPending };

async function requestOriginal(
  url: string,
  accessToken: string,
  signal: AbortSignal,
  ifNoneMatch: string | null,
): Promise<RequestOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/octet-stream, application/json, */*',
        Authorization: `Bearer ${accessToken}`,
        ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}),
      },
      signal: controller.signal,
    });
    if (response.status === 202) {
      const parsed = parseAttachmentDocumentPending(await response.text());
      if (!parsed) {
        throw new MobileApiError('invalid_response', 'Server 返回了无法识别的等待状态。', 202);
      }
      const headerSeconds = Number(response.headers.get('Retry-After'));
      const pending = parsed.retryAfterMs === undefined && Number.isFinite(headerSeconds) && headerSeconds >= 0
        ? { ...parsed, retryAfterMs: headerSeconds * 1_000 }
        : parsed;
      return { kind: 'pending', pending };
    }
    if (response.status === 304) return { kind: 'notModified' };
    if (!response.ok) {
      const error = await originalResponseError(response);
      if (error.status === 401 || error.status === 403) await clearOriginalFileCache().catch(() => undefined);
      throw error;
    }
    if (response.status !== 200) {
      throw new MobileApiError('invalid_response', 'Server 未返回完整附件。', response.status);
    }
    const lengthHeader = response.headers.get('Content-Length');
    if (lengthHeader !== null && /^\d+$/.test(lengthHeader.trim())) {
      const declaredLength = Number(lengthHeader);
      if (Number.isSafeInteger(declaredLength) && declaredLength > ORIGINAL_MAX_BYTES) {
        throw new MobileApiError('payload_too_large', '附件超过 20 MB，无法下载。', 413);
      }
    }
    return {
      kind: 'bytes',
      bytes: new Uint8Array(await response.arrayBuffer()),
      etag: normalizeAttachmentDocumentETag(response.headers.get('ETag')),
    };
  } catch (error) {
    if (signal.aborted) throw cancellationError();
    if (timedOut) {
      throw new MobileApiError('timeout', '下载附件超时，请检查网络后重试。', 0, true);
    }
    if (error instanceof MobileApiError) throw error;
    if (isOriginalFileAbortError(error)) throw cancellationError();
    throw new MobileApiError('network_error', '无法连接 Server，请检查网络后重试。', 0, true);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

async function originalResponseError(response: Response): Promise<MobileApiError> {
  let code = response.status === 401 ? 'unauthorized' : 'http_error';
  let message = response.statusText || `HTTP ${response.status}`;
  let retryable = response.status >= 500;
  try {
    const value: unknown = JSON.parse(await response.text());
    if (isRecord(value) && isRecord(value.error)) {
      if (typeof value.error.code === 'string') code = value.error.code;
      if (typeof value.error.message === 'string') message = value.error.message;
      if (typeof value.error.retryable === 'boolean') retryable = value.error.retryable;
    }
  } catch {
    // Status-based errors remain useful for a non-JSON response.
  }
  return new MobileApiError(code, message, response.status, retryable);
}

async function publishAtomically(
  key: string,
  destination: File,
  bytes: Uint8Array,
): Promise<File> {
  const temporary = new File(
    cacheDirectory(),
    `${key}.${Date.now()}-${++temporaryFileSequence}.tmp`,
  );
  const temporaryUri = temporary.uri;
  try {
    temporary.write(bytes);
    if (temporary.size !== bytes.byteLength) {
      throw new MobileApiError('write_failed', '附件未能完整写入本机缓存。');
    }
    const publication = moveAsync({ from: temporary.uri, to: destination.uri }).then(() => destination);
    activePublications.add(publication);
    try {
      await publication;
    } finally {
      activePublications.delete(publication);
    }
    if (destination.size !== bytes.byteLength) {
      discardFile(destination);
      throw new MobileApiError('write_failed', '本机附件缓存校验失败，请重试。');
    }
    return destination;
  } finally {
    discardFile(new File(temporaryUri));
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancellationError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(cancellationError());
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function throwIfCancelled(signal: AbortSignal, generation: number): void {
  if (signal.aborted || generation !== cacheGeneration) throw cancellationError();
}

function cancellationError(): Error {
  const error = new Error('附件下载已取消。');
  error.name = 'AbortError';
  return error;
}

function discardFile(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // A later download atomically replaces an undeleted stale entry.
  }
}

function cacheDirectory(): Directory {
  return new Directory(Paths.cache, CACHE_DIRECTORY_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
