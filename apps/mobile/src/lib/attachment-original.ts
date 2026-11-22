import { Directory, File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';

import { buildAttachmentUrl } from '@/lib/mobile-api';
import {
  nextPendingRetryMs,
  normalizeAttachmentETag,
  pendingAttachmentState,
  attachmentPreviewFailure,
  type AttachmentPendingState,
} from '@/lib/attachment-preview';
import type { MobileAttachment } from '@shared/types/mobile';

const REQUEST_TIMEOUT_MS = 30_000;
const ORIGINAL_MAX_BYTES = 20 * 1024 * 1024;
let temporaryFileSequence = 0;
let cacheGeneration = 0;

export type OriginalFileAuth = {
  readonly serverUrl: string;
  readonly accessToken: string;
};

export type DownloadedOriginalFile = {
  readonly file: File;
  readonly attachment: MobileAttachment;
};

export class OriginalDownloadError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'OriginalDownloadError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** Removes all locally cached original-file bytes. */
export async function clearOriginalFileCache(): Promise<void> {
  cacheGeneration += 1;
  const directory = originalFileDirectory();
  if (directory.exists) directory.delete();
}

/**
 * Downloads the original attachment bytes (not the PDF preview derivative).
 * Revalidates any cached copy with If-None-Match before serving it.
 */
export async function downloadOriginalFile(
  attachment: MobileAttachment,
  auth: OriginalFileAuth,
  options: {
    readonly signal?: AbortSignal;
    readonly onPending?: (state: AttachmentPendingState) => void;
  } = {},
): Promise<DownloadedOriginalFile> {
  if (!/^att_[A-Za-z0-9_-]{8,64}$/.test(attachment.attachmentId)) {
    throw new OriginalDownloadError('invalid_id', '附件标识无效。');
  }
  const generation = cacheGeneration;
  const directory = originalFileDirectory();
  directory.create({ idempotent: true, intermediates: true });
  const fileName = originalCacheFileName(attachment, auth.serverUrl);
  const destination = new File(directory, fileName);
  const cached = (await validCachedOriginal(destination, attachment)) ? destination : null;
  if (!cached) safeDelete(destination);
  const cachedETag = cached ? await readCachedETag(directory, fileName, attachment) : null;

  const startedAt = Date.now();
  let temporary: File | null = null;
  try {
    for (let attempt = 1; ; attempt += 1) {
      throwIfAborted(options.signal);
      const url = buildAttachmentUrl(auth.serverUrl, attachment.attachmentId);
      const outcome = await requestOriginal(url, auth.accessToken, attachment, options.signal, cachedETag);
      if (outcome.kind === 'pending') {
        const retryMs = nextPendingRetryMs({
          attempt,
          elapsedMs: Date.now() - startedAt,
          retryAfterHeader: outcome.retryAfterHeader,
          payload: outcome.payload,
        });
        if (retryMs === null) {
          throw new OriginalDownloadError('timeout', '等待附件超过 2 分钟，请稍后手动重试。', true);
        }
        options.onPending?.(outcome.state);
        await sleep(retryMs, options.signal);
        continue;
      }

      if (outcome.kind === 'notModified') {
        throwIfAborted(options.signal);
        if (
          generation !== cacheGeneration
          || !cached
          || !(await validCachedOriginal(cached, attachment))
        ) {
          throw new OriginalDownloadError('cache_cleared', '缓存已变化，请重新下载。', true);
        }
        return { file: cached, attachment };
      }

      const bytes = outcome.bytes;
      throwIfAborted(options.signal);
      if (bytes.byteLength > ORIGINAL_MAX_BYTES) {
        throw new OriginalDownloadError('too_large', '附件超过 20 MB，无法下载。');
      }
      if (
        Number.isSafeInteger(attachment.bytes)
        && attachment.bytes >= 0
        && bytes.byteLength !== attachment.bytes
      ) {
        throw new OriginalDownloadError('bytes_mismatch', '附件大小与记录不一致，请重试。', true);
      }

      temporaryFileSequence += 1;
      temporary = new File(directory, `${fileName}.${temporaryFileSequence}.tmp`);
      safeDelete(temporary);
      await temporary.write(bytes);
      throwIfAborted(options.signal);
      if (generation !== cacheGeneration) {
        throw new OriginalDownloadError('cache_cleared', '缓存已随登录状态清理，请重新下载。', true);
      }
      if (await validCachedOriginal(temporary, attachment)) {
        if (await validCachedOriginal(destination, attachment)) {
          safeDelete(temporary);
          temporary = null;
          if (generation !== cacheGeneration) {
            throw new OriginalDownloadError('cache_cleared', '缓存已变化，请重新下载。', true);
          }
          await writeCachedETag(directory, fileName, outcome.etag);
          return { file: destination, attachment };
        }
        safeDelete(destination);
        await temporary.move(destination);
        if (generation !== cacheGeneration) {
          safeDelete(destination);
          throw new OriginalDownloadError('cache_cleared', '缓存已变化，请重新下载。', true);
        }
        const published = destination;
        temporary = null;
        await writeCachedETag(directory, fileName, outcome.etag);
        if (generation !== cacheGeneration) {
          safeDelete(destination);
          throw new OriginalDownloadError('cache_cleared', '缓存已变化，请重新下载。', true);
        }
        return { file: published, attachment };
      }
      throw new OriginalDownloadError('invalid_file', '附件写入本地后校验失败，请重试。', true);
    }
  } catch (error) {
    if (error instanceof OriginalDownloadError || isAbortError(error) || options.signal?.aborted) {
      throw error;
    }
    throw new OriginalDownloadError('download_failed', '附件下载失败，请检查网络后重试。', true);
  } finally {
    if (temporary) safeDelete(temporary);
  }
}

function originalFileDirectory(): Directory {
  return new Directory(Paths.cache, 'attachment-originals');
}

function originalCacheFileName(attachment: MobileAttachment, serverUrl: string): string {
  const hash = stableHash(serverUrl.replace(/\/+$/, ''));
  return `server-${hash}-id-${attachment.attachmentId}.original`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function originalETagFile(directory: Directory, fileName: string): File {
  return new File(directory, `${fileName}.etag`);
}

async function readCachedETag(
  directory: Directory,
  fileName: string,
  attachment: MobileAttachment,
): Promise<string | null> {
  try {
    const etagFile = originalETagFile(directory, fileName);
    if (etagFile.exists) {
      const etag = normalizeAttachmentETag(await etagFile.text());
      if (etag) return etag;
    }
  } catch {
    // Missing or invalid metadata forces a full authorized download.
  }
  const sha256 = attachment.sha256?.toLowerCase();
  return sha256 && /^[a-f0-9]{64}$/.test(sha256) ? `"${sha256}"` : null;
}

async function writeCachedETag(directory: Directory, fileName: string, etag: string | null): Promise<void> {
  const etagFile = originalETagFile(directory, fileName);
  if (!etag) {
    safeDelete(etagFile);
    return;
  }
  try {
    await etagFile.write(etag);
  } catch {
    safeDelete(etagFile);
  }
}

async function validCachedOriginal(file: File, attachment: MobileAttachment): Promise<boolean> {
  try {
    if (!file.exists) return false;
    const size = file.size;
    if (size === null || size > ORIGINAL_MAX_BYTES) return false;
    if (
      Number.isSafeInteger(attachment.bytes)
      && attachment.bytes >= 0
      && size !== attachment.bytes
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

type OriginalRequestOutcome =
  | {
    readonly kind: 'pending';
    readonly state: AttachmentPendingState;
    readonly retryAfterHeader: string | null;
    readonly payload: unknown;
  }
  | { readonly kind: 'notModified' }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly etag: string | null };

async function requestOriginal(
  url: string,
  accessToken: string,
  attachment: MobileAttachment,
  parentSignal?: AbortSignal,
  ifNoneMatch?: string | null,
): Promise<OriginalRequestOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abort();
  parentSignal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/octet-stream, application/json, */*',
        ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}),
      },
      signal: controller.signal,
    });
    if (response.status === 202) {
      const payload = await readJsonPayload(response);
      const state = pendingAttachmentState(payload);
      if (!state) {
        throw new OriginalDownloadError('invalid_response', 'Server 返回了无法识别的等待状态。');
      }
      return {
        kind: 'pending',
        state,
        retryAfterHeader: response.headers.get('Retry-After'),
        payload,
      };
    }
    if (response.status === 304) {
      return { kind: 'notModified' };
    }
    if (response.status !== 200) {
      const failure = attachmentPreviewFailure(response.status, await readJsonPayload(response));
      if (failure.code === 'unauthorized' || failure.code === 'forbidden') {
        await clearOriginalFileCache().catch(() => undefined);
      }
      throw new OriginalDownloadError(failure.code, failure.message, failure.retryable);
    }
    const contentLength = response.headers.get('Content-Length');
    if (contentLength !== null && /^\d+$/.test(contentLength.trim())) {
      const length = Number(contentLength);
      if (Number.isSafeInteger(length) && length > ORIGINAL_MAX_BYTES) {
        throw new OriginalDownloadError('too_large', '附件超过 20 MB，无法下载。');
      }
    }
    const bytes = await response.bytes();
    throwIfAborted(parentSignal);
    return { kind: 'bytes', bytes, etag: normalizeAttachmentETag(response.headers.get('ETag')) };
  } catch (error) {
    if (parentSignal?.aborted) throw error;
    if (timedOut) {
      throw new OriginalDownloadError('timeout', '下载附件超时，请检查网络后重试。', true);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abort);
  }
}

async function readJsonPayload(response: { text(): Promise<string> }): Promise<unknown> {
  try {
    const text = await response.text();
    return text.length <= 64 * 1024 ? JSON.parse(text) as unknown : null;
  } catch {
    return null;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function safeDelete(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // A stale temporary/cache file must not expose a server error as content.
  }
}
