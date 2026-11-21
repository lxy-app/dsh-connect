import { Directory, File, Paths } from 'expo-file-system';
import { moveAsync } from 'expo-file-system/legacy';

import {
  attachmentDocumentCacheKey,
  attachmentDocumentKind,
  attachmentDocumentRetryDelayMs,
  buildAttachmentDocumentUrl,
  canServeCachedAttachmentDocument,
  hasExpectedOriginalByteLength,
  hasPdfMagic,
  isAttachmentDocumentWithinLimit,
  isOfficePdfPreview,
  normalizeAttachmentDocumentETag,
  parseAttachmentDocumentPending,
  type AttachmentDocumentKind,
  type AttachmentDocumentPending,
} from '@/lib/attachment-documents';
import { MobileApiError } from '@/lib/mobile-api';
import type { MobileAttachment } from '@shared/types/mobile';

const CACHE_DIRECTORY_NAME = 'dsh-attachment-documents-v1';
const REQUEST_TIMEOUT_MS = 30_000;
const activePublications = new Set<Promise<File>>();
let cacheGeneration = 0;
let temporaryFileSequence = 0;

export type AttachmentDocumentAuth = {
  readonly serverUrl: string;
  readonly accessToken: string;
};

export type LoadedAttachmentDocument = {
  readonly kind: AttachmentDocumentKind;
  readonly file: File;
  readonly text?: string;
  readonly cacheHit: boolean;
};

export type AttachmentDocumentLoadOptions = {
  readonly attachment: MobileAttachment;
  readonly auth: AttachmentDocumentAuth;
  readonly signal: AbortSignal;
  readonly onPending?: (pending: AttachmentDocumentPending, attempt: number) => void;
};

/** Downloads only after a viewer mounts; metadata rendering never calls this. */
export async function loadAttachmentDocument(
  options: AttachmentDocumentLoadOptions,
): Promise<LoadedAttachmentDocument> {
  const kind = attachmentDocumentKind(options.attachment);
  if (!kind) throw new MobileApiError('preview_unsupported', '该文件类型暂不支持应用内预览。', 415);
  const url = buildAttachmentDocumentUrl(options.auth.serverUrl, options.attachment.attachmentId, kind);
  const key = attachmentDocumentCacheKey(options.attachment, options.auth.serverUrl, kind);
  const generation = cacheGeneration;
  const destination = new File(cacheDirectory(), `${key}.${kind === 'pdf' ? 'pdf' : 'document'}`);
  throwIfCancelled(options.signal, generation);

  const cached = readValidCache(destination, kind, options.attachment.bytes, options.signal, generation);
  const cachedETag = cached
    ? readCachedETag(key, options.attachment)
    : null;

  cacheDirectory().create({ intermediates: true, idempotent: true });
  const startedAt = Date.now();
  let attempt = 1;
  while (true) {
    throwIfCancelled(options.signal, generation);
    const outcome = await requestDocument(url, kind, options.auth.accessToken, options.signal, cachedETag);
    throwIfCancelled(options.signal, generation);
    if (outcome.kind === 'pending') {
      const delayMs = attachmentDocumentRetryDelayMs(outcome.pending, attempt, Date.now() - startedAt);
      if (delayMs === null) {
        throw new MobileApiError(
          'preview_timeout',
          '文档准备时间较长，请稍后手动重试。',
          202,
          true,
        );
      }
      options.onPending?.(outcome.pending, attempt);
      await abortableDelay(delayMs, options.signal);
      attempt += 1;
      continue;
    }

    if (outcome.kind === 'notModified') {
      const validCached = cached
        ? readValidCache(cached, kind, options.attachment.bytes, options.signal, generation)
        : null;
      if (!validCached || !canServeCachedAttachmentDocument(304, validCached !== null)) {
        throw new MobileApiError('cache_cleared', '文档缓存已变化，请重新打开预览。', 304, true);
      }
      throwIfCancelled(options.signal, generation);
      return finishLoad(validCached, kind, true, options.signal, generation);
    }

    validateDownloadedBytes(outcome.bytes, kind, options.attachment.bytes);
    throwIfCancelled(options.signal, generation);
    let published: File;
    try {
      published = await publishAtomically(key, destination, outcome.bytes, kind);
    } catch (error) {
      throwIfCancelled(options.signal, generation);
      throw error;
    }
    throwIfCancelled(options.signal, generation);
    writeCachedETag(key, outcome.etag);
    throwIfCancelled(options.signal, generation);
    return finishLoad(published, kind, false, options.signal, generation);
  }
}

/**
 * Clears only the document cache, never expo-image's image cache. In-flight
 * requests cannot publish into a newer login generation; current renames are
 * awaited before the directory is removed.
 */
export async function clearAttachmentDocumentCache(): Promise<void> {
  cacheGeneration += 1;
  await Promise.allSettled([...activePublications]);
  const directory = cacheDirectory();
  if (directory.exists) directory.delete();
}

export function isAttachmentDocumentAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function finishLoad(
  file: File,
  kind: AttachmentDocumentKind,
  cacheHit: boolean,
  signal: AbortSignal,
  generation: number,
): Promise<LoadedAttachmentDocument> {
  if (kind === 'pdf') {
    throwIfCancelled(signal, generation);
    return { kind, file, cacheHit };
  }
  try {
    const text = await file.text();
    throwIfCancelled(signal, generation);
    return { kind, file, text, cacheHit };
  } catch (error) {
    throwIfCancelled(signal, generation);
    throw error;
  }
}

function readValidCache(
  file: File,
  kind: AttachmentDocumentKind,
  expectedBytes: number,
  signal: AbortSignal,
  generation: number,
): File | null {
  if (!file.exists) return null;
  try {
    if (!isAttachmentDocumentWithinLimit(file.size, kind)) {
      discardFile(file);
      return null;
    }
    const valid = kind === 'pdf'
      ? fileHasPdfMagic(file)
      : Number.isSafeInteger(expectedBytes) && expectedBytes >= 0 && file.size === expectedBytes;
    throwIfCancelled(signal, generation);
    if (valid) return file;
  } catch (error) {
    if (isAttachmentDocumentAbortError(error)) throw error;
    throwIfCancelled(signal, generation);
    // An unreadable entry is treated as a cache miss and replaced atomically.
  }
  throwIfCancelled(signal, generation);
  discardFile(file);
  return null;
}

function validateDownloadedBytes(
  bytes: Uint8Array,
  kind: AttachmentDocumentKind,
  expectedOriginalBytes: number,
): void {
  if (!isAttachmentDocumentWithinLimit(bytes.byteLength, kind)) {
    throw new MobileApiError(
      'payload_too_large',
      kind === 'pdf' ? 'PDF 超过 50 MB，无法在应用内预览。' : '文本附件超过 2 MB，无法在应用内预览。',
      413,
    );
  }
  if (kind === 'pdf') {
    if (!hasPdfMagic(bytes)) {
      throw new MobileApiError('invalid_pdf', 'Server 未返回有效的 PDF 预览。', 200);
    }
    return;
  }
  if (!hasExpectedOriginalByteLength(bytes, expectedOriginalBytes)) {
    throw new MobileApiError(
      'document_bytes_mismatch',
      '下载的文件长度与附件元数据不一致，请重试。',
      200,
    );
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
  return !isOfficePdfPreview(attachment) && sha256 && /^[a-f0-9]{64}$/.test(sha256)
    ? `"${sha256}"`
    : null;
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

async function requestDocument(
  url: string,
  kind: AttachmentDocumentKind,
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
        Accept: kind === 'pdf' ? 'application/pdf, application/json' : '*/*',
        Authorization: `Bearer ${accessToken}`,
        ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}),
      },
      signal: controller.signal,
    });
    if (response.status === 202) {
      const parsed = parseAttachmentDocumentPending(await response.text());
      if (!parsed) {
        throw new MobileApiError('invalid_response', 'Server 返回了无法识别的文档准备状态。', 202);
      }
      const headerSeconds = Number(response.headers.get('Retry-After'));
      const pending = parsed.retryAfterMs === undefined && Number.isFinite(headerSeconds) && headerSeconds >= 0
        ? { ...parsed, retryAfterMs: headerSeconds * 1_000 }
        : parsed;
      return { kind: 'pending', pending };
    }
    if (response.status === 304) return { kind: 'notModified' };
    if (!response.ok) {
      const error = await documentResponseError(response);
      if (error.status === 401 || error.status === 403) await clearAttachmentDocumentCache().catch(() => undefined);
      throw error;
    }
    if (response.status !== 200) {
      throw new MobileApiError('invalid_response', 'Server 未返回完整文档。', response.status);
    }
    const lengthHeader = response.headers.get('Content-Length');
    if (lengthHeader !== null && /^\d+$/.test(lengthHeader.trim())) {
      const declaredLength = Number(lengthHeader);
      if (Number.isSafeInteger(declaredLength) && !isAttachmentDocumentWithinLimit(declaredLength, kind)) {
        throw new MobileApiError('payload_too_large', '文档超过应用内预览大小限制。', 413);
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
      throw new MobileApiError('timeout', '下载文档超时，请检查网络后重试。', 0, true);
    }
    if (error instanceof MobileApiError) throw error;
    if (isAttachmentDocumentAbortError(error)) throw cancellationError();
    throw new MobileApiError('network_error', '无法连接 Server，请检查网络后重试。', 0, true);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

async function documentResponseError(response: Response): Promise<MobileApiError> {
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
  kind: AttachmentDocumentKind,
): Promise<File> {
  const temporary = new File(
    cacheDirectory(),
    `${key}.${Date.now()}-${++temporaryFileSequence}.tmp`,
  );
  const temporaryUri = temporary.uri;
  try {
    temporary.write(bytes);
    if (temporary.size !== bytes.byteLength) {
      throw new MobileApiError('document_write_failed', '文档未能完整写入本机缓存。');
    }
    // SDK 55 File.move accepts one argument and cannot replace an existing
    // destination. The legacy same-directory move provides atomic replacement.
    const publication = moveAsync({ from: temporary.uri, to: destination.uri }).then(() => destination);
    activePublications.add(publication);
    try {
      await publication;
    } finally {
      activePublications.delete(publication);
    }
    const valid = kind === 'pdf' ? fileHasPdfMagic(destination) : destination.size === bytes.byteLength;
    if (!valid) {
      discardFile(destination);
      throw new MobileApiError('document_write_failed', '本机文档缓存校验失败，请重试。');
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
  const error = new Error('文档预览已取消。');
  error.name = 'AbortError';
  return error;
}

function fileHasPdfMagic(file: File): boolean {
  const handle = file.open();
  try {
    // A cache hit must not read a potentially 50 MB PDF just to inspect %PDF-.
    return hasPdfMagic(handle.readBytes(5));
  } finally {
    handle.close();
  }
}

function discardFile(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // A later download atomically replaces an undeleted stale entry.
  }
}

function cacheDirectory(): Directory {
  // Keep native path construction lazy for Expo Router's server-side export.
  return new Directory(Paths.cache, CACHE_DIRECTORY_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
