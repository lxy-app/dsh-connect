import { Directory, File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';

import { buildAttachmentPreviewUrl, buildAttachmentUrl } from '@/lib/mobile-api';
import {
  attachmentCacheFileName,
  attachmentPreviewFailure,
  attachmentPreviewSpec,
  canServeCachedAttachment,
  describeAttachmentPreviewError,
  nextPendingRetryMs,
  normalizeAttachmentETag,
  pendingAttachmentState,
  validateAttachmentPreviewBytes,
  hasPdfMagic,
  type AttachmentPendingState,
  type AttachmentPreviewSpec,
} from '@/lib/attachment-preview';
import type { MobileAttachment } from '@shared/types/mobile';

const REQUEST_TIMEOUT_MS = 30_000;
let temporaryFileSequence = 0;
let cacheGeneration = 0;

export type AttachmentDocumentAuth = {
  readonly serverUrl: string;
  readonly accessToken: string;
};

export type DownloadedAttachmentDocument = {
  readonly file: File;
  readonly spec: AttachmentPreviewSpec;
};

export class AttachmentPreviewError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status = 0, retryable = false) {
    super(message);
    this.name = 'AttachmentPreviewError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/** Removes all locally cached document bytes; image caching is owned by expo-image. */
export async function clearAttachmentDocumentCache(): Promise<void> {
  cacheGeneration += 1;
  const directory = attachmentDocumentDirectory();
  if (directory.exists) directory.delete();
}

/**
 * Downloads only after an explicit viewer mount. A 200 body is validated in
 * memory, written to a temporary file, then atomically moved into the cache.
 */
export async function downloadAttachmentDocument(
  attachment: MobileAttachment,
  auth: AttachmentDocumentAuth,
  options: {
    readonly signal?: AbortSignal;
    readonly onPending?: (state: AttachmentPendingState) => void;
  } = {},
): Promise<DownloadedAttachmentDocument> {
  const spec = attachmentPreviewSpec(attachment);
  if (!spec) {
    throw new AttachmentPreviewError('preview_unsupported', '此附件不支持应用内预览。');
  }
  const generation = cacheGeneration;
  const directory = attachmentDocumentDirectory();
  directory.create({ idempotent: true, intermediates: true });
  const fileName = attachmentCacheFileName(attachment, auth.serverUrl);
  const destination = new File(directory, fileName);
  const cached = await validCachedDocument(destination, attachment, spec) ? destination : null;
  if (!cached) safeDelete(destination);
  const cachedETag = cached
    ? await readCachedETag(directory, fileName, attachment, spec)
    : null;

  const startedAt = Date.now();
  let temporary: File | null = null;
  try {
    for (let attempt = 1; ; attempt += 1) {
      throwIfAborted(options.signal);
      const url = spec.source === 'preview'
        ? buildAttachmentPreviewUrl(auth.serverUrl, attachment.attachmentId)
        : buildAttachmentUrl(auth.serverUrl, attachment.attachmentId);
      const outcome = await requestAttachment(url, auth.accessToken, attachment, spec, options.signal, cachedETag);
      if (outcome.kind === 'pending') {
        const retryMs = nextPendingRetryMs({
          attempt,
          elapsedMs: Date.now() - startedAt,
          retryAfterHeader: outcome.retryAfterHeader,
          payload: outcome.payload,
        });
        if (retryMs === null) {
          throw new AttachmentPreviewError(
            'preview_timeout',
            '等待附件或 PDF 转换超过 2 分钟，请稍后手动重试。',
            202,
            true,
          );
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
          || !canServeCachedAttachment(304, await validCachedDocument(cached, attachment, spec))
        ) {
          throw new AttachmentPreviewError('cache_cleared', '缓存已变化，请重新打开预览。', 304, true);
        }
        return { file: cached, spec };
      }

      const bytes = outcome.bytes;
      throwIfAborted(options.signal);
      const invalid = validateAttachmentPreviewBytes(bytes, attachment, spec);
      if (invalid) {
        throw new AttachmentPreviewError(invalid.code, invalid.message, 200, invalid.retryable);
      }

      temporaryFileSequence += 1;
      temporary = new File(directory, `${fileName}.${temporaryFileSequence}.tmp`);
      safeDelete(temporary);
      await temporary.write(bytes);
      throwIfAborted(options.signal);
      if (generation !== cacheGeneration) {
        throw new AttachmentPreviewError('cache_cleared', '文档缓存已随登录状态清理，请重新打开预览。');
      }
      if (await validCachedDocument(temporary, attachment, spec)) {
        // Another viewer may have published the same immutable document first.
        if (await validCachedDocument(destination, attachment, spec)) {
          safeDelete(temporary);
          temporary = null;
          if (generation !== cacheGeneration) {
            throw new AttachmentPreviewError('cache_cleared', '文档缓存已随登录状态清理，请重新打开预览。');
          }
          await writeCachedETag(directory, fileName, outcome.etag);
          if (generation !== cacheGeneration) {
            safeDelete(destination);
            throw new AttachmentPreviewError('cache_cleared', '文档缓存已随登录状态清理，请重新打开预览。');
          }
          return { file: destination, spec };
        }
        safeDelete(destination);
        await temporary.move(destination);
        if (generation !== cacheGeneration) {
          safeDelete(destination);
          throw new AttachmentPreviewError('cache_cleared', '文档缓存已随登录状态清理，请重新打开预览。');
        }
        const published = destination;
        temporary = null;
        await writeCachedETag(directory, fileName, outcome.etag);
        if (generation !== cacheGeneration) {
          safeDelete(destination);
          throw new AttachmentPreviewError('cache_cleared', '文档缓存已随登录状态清理，请重新打开预览。');
        }
        return { file: published, spec };
      }
      throw new AttachmentPreviewError('invalid_file', '附件写入本地后校验失败，请重试。', 0, true);
    }
  } catch (error) {
    if (error instanceof AttachmentPreviewError || isAbortError(error) || options.signal?.aborted) {
      throw error;
    }
    throw new AttachmentPreviewError(
      'download_failed',
      describeAttachmentPreviewError(error),
      0,
      true,
    );
  } finally {
    if (temporary) safeDelete(temporary);
  }
}

function attachmentDocumentDirectory(): Directory {
  return new Directory(Paths.cache, 'attachment-documents');
}

function attachmentETagFile(directory: Directory, fileName: string): File {
  return new File(directory, `${fileName}.etag`);
}

async function readCachedETag(
  directory: Directory,
  fileName: string,
  attachment: MobileAttachment,
  spec: AttachmentPreviewSpec,
): Promise<string | null> {
  try {
    const etagFile = attachmentETagFile(directory, fileName);
    if (etagFile.exists) {
      const etag = normalizeAttachmentETag(await etagFile.text());
      if (etag) return etag;
    }
  } catch {
    // Missing or invalid metadata forces a full authorized download.
  }
  const sha256 = attachment.sha256?.toLowerCase();
  return spec.source === 'original' && sha256 && /^[a-f0-9]{64}$/.test(sha256)
    ? `"${sha256}"`
    : null;
}

async function writeCachedETag(directory: Directory, fileName: string, etag: string | null): Promise<void> {
  const etagFile = attachmentETagFile(directory, fileName);
  if (!etag) {
    safeDelete(etagFile);
    return;
  }
  try {
    await etagFile.write(etag);
  } catch {
    // A missing ETag only causes a full download next time; never reuse stale metadata.
    safeDelete(etagFile);
  }
}

async function validCachedDocument(
  file: File,
  attachment: MobileAttachment,
  spec: AttachmentPreviewSpec,
): Promise<boolean> {
  try {
    if (!file.exists) return false;
    const size = file.size;
    if (size === null || size > spec.maxBytes) return false;
    if (
      spec.source === 'original'
      && Number.isSafeInteger(attachment.bytes)
      && attachment.bytes >= 0
      && size !== attachment.bytes
    ) {
      return false;
    }
    if (spec.extension === 'pdf') {
      const handle = file.open();
      try {
        if (!hasPdfMagic(await handle.readBytes(5))) return false;
      } finally {
        handle.close();
      }
    }
    return true;
  } catch {
    return false;
  }
}

function validateResponseLength(
  header: string | null,
  attachment: MobileAttachment,
  spec: AttachmentPreviewSpec,
): void {
  if (header === null || !/^\d+$/.test(header.trim())) return;
  const length = Number(header);
  if (!Number.isSafeInteger(length)) return;
  if (length > spec.maxBytes) {
    throw new AttachmentPreviewError(
      'payload_too_large',
      spec.source === 'preview'
        ? '生成的 PDF 超过 50 MB，无法预览。'
        : spec.kind === 'markdown' || spec.kind === 'text'
          ? '文本附件超过 2 MB，无法在应用内预览。'
          : 'PDF 附件超过 20 MB，无法在应用内预览。',
      413,
    );
  }
  if (spec.source === 'original' && Number.isSafeInteger(attachment.bytes) && length !== attachment.bytes) {
    throw new AttachmentPreviewError(
      'invalid_attachment_bytes',
      'Server 返回的附件大小与记录不一致，请重试。',
      200,
      true,
    );
  }
}

type AttachmentRequestOutcome =
  | {
    readonly kind: 'pending';
    readonly state: AttachmentPendingState;
    readonly retryAfterHeader: string | null;
    readonly payload: unknown;
  }
  | { readonly kind: 'notModified' }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly etag: string | null };

/** The same controller covers headers and body reads, including response.bytes(). */
async function requestAttachment(
  url: string,
  accessToken: string,
  attachment: MobileAttachment,
  spec: AttachmentPreviewSpec,
  parentSignal?: AbortSignal,
  ifNoneMatch?: string | null,
): Promise<AttachmentRequestOutcome> {
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
        Accept: 'application/pdf, application/octet-stream, application/json',
        ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}),
      },
      signal: controller.signal,
    });
    if (response.status === 202) {
      const payload = await readJsonPayload(response);
      const state = pendingAttachmentState(payload);
      if (!state) {
        throw new AttachmentPreviewError('invalid_response', 'Server 返回了无法识别的预览等待状态。', 202);
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
        await clearAttachmentDocumentCache().catch(() => undefined);
      }
      throw new AttachmentPreviewError(
        failure.code,
        failure.message,
        response.status,
        failure.retryable,
      );
    }
    validateResponseLength(response.headers.get('Content-Length'), attachment, spec);
    const bytes = await response.bytes();
    throwIfAborted(parentSignal);
    return { kind: 'bytes', bytes, etag: normalizeAttachmentETag(response.headers.get('ETag')) };
  } catch (error) {
    if (parentSignal?.aborted) throw error;
    if (timedOut) {
      throw new AttachmentPreviewError('timeout', '下载附件超时，请检查网络后重试。', 0, true);
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
