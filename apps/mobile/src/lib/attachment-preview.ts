import { normalizeServerUrl } from '@/lib/mobile-api';
import type { MobileAttachment } from '@shared/types/mobile';

export const TEXT_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const ORIGINAL_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const PDF_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;
export const ATTACHMENT_PENDING_TIMEOUT_MS = 120_000;
export const ATTACHMENT_PENDING_MAX_ATTEMPTS = 121;
export const DEFAULT_PENDING_RETRY_MS = 1_000;
export const MAX_PENDING_RETRY_MS = 5_000;

export type AttachmentPreviewKind =
  | 'image'
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'office'
  | 'unsupported';

export type AttachmentPreviewSource = 'original' | 'preview';
export type AttachmentPendingState = 'fetching' | 'converting';

export type AttachmentPreviewSpec = {
  readonly kind: Exclude<AttachmentPreviewKind, 'image' | 'unsupported'>;
  readonly source: AttachmentPreviewSource;
  readonly extension: 'md' | 'txt' | 'pdf';
  readonly cacheVersion: 'source-v1' | 'preview-v1';
  readonly maxBytes: number;
};

export type AttachmentPreviewFailure = {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
};

const MARKDOWN_MIMES = new Set(['text/markdown', 'text/x-markdown']);
const TEXT_MIMES = new Set([
  'text/plain',
  'application/json',
  'text/json',
  'application/x-json',
  'application/log',
  'text/log',
  'text/x-log',
]);
const OFFICE_MIMES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const GENERIC_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const EXTENSIONS: Readonly<Record<string, Exclude<AttachmentPreviewKind, 'image' | 'unsupported'>>> = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  json: 'text',
  log: 'text',
  pdf: 'pdf',
  doc: 'office',
  docx: 'office',
  ppt: 'office',
  pptx: 'office',
  xls: 'office',
  xlsx: 'office',
};

/** MIME is authoritative; a filename extension only refines generic/plain metadata. */
export function attachmentPreviewKind(
  attachment: Pick<MobileAttachment, 'kind' | 'mime' | 'name'>,
): AttachmentPreviewKind {
  const mime = attachment.mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (attachment.kind === 'image' || mime.startsWith('image/')) return 'image';
  if (MARKDOWN_MIMES.has(mime)) return 'markdown';
  if (mime === 'application/pdf') return 'pdf';
  if (OFFICE_MIMES.has(mime)) return 'office';

  const extension = attachment.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const extensionKind = EXTENSIONS[extension];
  // A plain-text MIME is not specific enough to distinguish Markdown from TXT.
  if (mime === 'text/plain' && extensionKind === 'markdown') return 'markdown';
  if (TEXT_MIMES.has(mime)) return 'text';
  if (GENERIC_MIMES.has(mime)) return extensionKind ?? 'unsupported';
  return 'unsupported';
}

export function canOpenAttachment(attachment: MobileAttachment): boolean {
  const kind = attachmentPreviewKind(attachment);
  // Every available file can open the shared viewer. Unsupported formats use
  // its download-only state instead of becoming a dead card or link.
  return kind === 'image' || attachment.state !== 'unavailable';
}

export function attachmentPreviewSpec(
  attachment: Pick<MobileAttachment, 'kind' | 'mime' | 'name'>,
): AttachmentPreviewSpec | null {
  switch (attachmentPreviewKind(attachment)) {
    case 'markdown':
      return {
        kind: 'markdown', source: 'original', extension: 'md', cacheVersion: 'source-v1',
        maxBytes: TEXT_ATTACHMENT_MAX_BYTES,
      };
    case 'text':
      return {
        kind: 'text', source: 'original', extension: 'txt', cacheVersion: 'source-v1',
        maxBytes: TEXT_ATTACHMENT_MAX_BYTES,
      };
    case 'pdf':
      return {
        kind: 'pdf', source: 'original', extension: 'pdf', cacheVersion: 'source-v1',
        maxBytes: ORIGINAL_ATTACHMENT_MAX_BYTES,
      };
    case 'office':
      return {
        kind: 'office', source: 'preview', extension: 'pdf', cacheVersion: 'preview-v1',
        maxBytes: PDF_PREVIEW_MAX_BYTES,
      };
    default:
      return null;
  }
}

/**
 * Uses the immutable opaque id, never a desktop path/name. Keeping the same
 * key before/after sha256 arrives avoids downloading known→ready bytes twice.
 */
export function attachmentCacheFileName(
  attachment: Pick<MobileAttachment, 'attachmentId' | 'kind' | 'mime' | 'name'>,
  serverUrl: string,
): string {
  const spec = attachmentPreviewSpec(attachment);
  if (!spec) throw new Error('Attachment has no document preview strategy.');
  if (!/^att_[A-Za-z0-9_-]{8,64}$/.test(attachment.attachmentId)) {
    throw new Error('Attachment cache identity is invalid.');
  }
  const serverHash = stableServerHash(normalizeServerUrl(serverUrl));
  return `server-${serverHash}-id-${attachment.attachmentId}.${spec.cacheVersion}.${spec.extension}`;
}

function stableServerHash(serverUrl: string): string {
  // Filename identity only; response byte length and PDF magic are still checked.
  return `${fnv1a(serverUrl, 0x811c9dc5)}${fnv1a(serverUrl, 0x01000193)}`;
}

function fnv1a(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function normalizeAttachmentETag(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return /^"[a-f0-9]{64}"$/.test(normalized) ? normalized : null;
}

/** Cached bytes are readable only after an authorized 304 revalidation. */
export function canServeCachedAttachment(status: number, hasValidCache: boolean): boolean {
  return status === 304 && hasValidCache;
}

export function hasPdfMagic(bytes: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  return magic.every((value, index) => bytes[index] === value);
}

/** Validates fresh bytes before any temporary file can become a cached document. */
export function validateAttachmentPreviewBytes(
  bytes: Uint8Array,
  attachment: MobileAttachment,
  spec: AttachmentPreviewSpec,
): AttachmentPreviewFailure | null {
  if (bytes.byteLength > spec.maxBytes) {
    return {
      code: 'payload_too_large',
      message: spec.source === 'preview'
        ? '生成的 PDF 超过 50 MB，无法预览。'
        : spec.kind === 'markdown' || spec.kind === 'text'
          ? '文本附件超过 2 MB，无法在应用内预览。'
          : 'PDF 附件超过 20 MB，无法在应用内预览。',
      retryable: false,
    };
  }
  if (
    spec.source === 'original'
    && Number.isSafeInteger(attachment.bytes)
    && attachment.bytes >= 0
    && bytes.byteLength !== attachment.bytes
  ) {
    return {
      code: 'invalid_attachment_bytes',
      message: 'Server 返回的附件大小与记录不一致，请重试。',
      retryable: true,
    };
  }
  if (spec.extension === 'pdf' && !hasPdfMagic(bytes)) {
    return {
      code: 'invalid_pdf',
      message: 'Server 返回的内容不是有效的 PDF 文件。',
      retryable: false,
    };
  }
  return null;
}

export function parsePendingRetryMs(
  retryAfterHeader: string | null,
  payload: unknown,
): number {
  const bodyRetry = isRecord(payload) && typeof payload.retryAfterMs === 'number'
    && Number.isFinite(payload.retryAfterMs) && payload.retryAfterMs >= 0
    ? payload.retryAfterMs
    : null;
  const headerSeconds = retryAfterHeader !== null && retryAfterHeader.trim() !== ''
    ? Number(retryAfterHeader)
    : Number.NaN;
  const headerRetry = Number.isFinite(headerSeconds) && headerSeconds >= 0
    ? headerSeconds * 1_000
    : null;
  const requested = bodyRetry ?? headerRetry ?? DEFAULT_PENDING_RETRY_MS;
  return Math.min(MAX_PENDING_RETRY_MS, Math.max(250, requested));
}

export function pendingAttachmentState(payload: unknown): AttachmentPendingState | null {
  if (!isRecord(payload)) return null;
  return payload.state === 'fetching' || payload.state === 'converting' ? payload.state : null;
}

/** Returns null at either retry bound; normal 90-second conversions remain inside the budget. */
export function nextPendingRetryMs(input: {
  readonly attempt: number;
  readonly elapsedMs: number;
  readonly retryAfterHeader: string | null;
  readonly payload: unknown;
}): number | null {
  if (input.attempt < 1 || input.attempt >= ATTACHMENT_PENDING_MAX_ATTEMPTS) return null;
  if (input.elapsedMs < 0 || input.elapsedMs >= ATTACHMENT_PENDING_TIMEOUT_MS) return null;
  return Math.min(
    parsePendingRetryMs(input.retryAfterHeader, input.payload),
    ATTACHMENT_PENDING_TIMEOUT_MS - input.elapsedMs,
  );
}

export function attachmentPreviewFailure(
  status: number,
  payload: unknown,
): AttachmentPreviewFailure {
  const serverCode = isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === 'string'
    ? payload.error.code
    : isRecord(payload) && typeof payload.errorCode === 'string'
      ? payload.errorCode
      : '';
  if (serverCode === 'attachment_denied') {
    return { code: serverCode, message: '桌面拒绝提供该文件。', retryable: false };
  }
  if (status === 401) {
    return { code: 'unauthorized', message: '登录凭据已失效，请重新登录后重试。', retryable: false };
  }
  if (status === 403) {
    return { code: 'forbidden', message: '当前授权不允许查看此附件。', retryable: false };
  }
  if (status === 404) {
    return { code: 'not_found', message: '附件不存在或已过期。', retryable: false };
  }
  if (status === 409 || serverCode === 'preview_failed') {
    return {
      code: serverCode || 'preview_failed',
      message: serverCode === 'preview_failed' ? '文档转换失败，请重试或在桌面查看。' : '附件当前不可用，请重试。',
      retryable: true,
    };
  }
  if (status === 413) {
    return { code: 'payload_too_large', message: '附件或生成的 PDF 超过预览大小限制。', retryable: false };
  }
  if (status === 415 || serverCode === 'preview_unsupported') {
    return { code: 'preview_unsupported', message: 'Server 不支持将此格式转换为 PDF。', retryable: false };
  }
  if (status === 429) {
    return { code: 'rate_limited', message: '预览请求过于频繁，请稍后重试。', retryable: true };
  }
  if (status === 503 && serverCode === 'preview_unavailable') {
    return { code: serverCode, message: 'Server 尚未配置文档转换服务，请在桌面查看原文件。', retryable: false };
  }
  if (status >= 500) {
    return { code: serverCode || 'server_error', message: '预览服务暂时不可用，请稍后重试。', retryable: true };
  }
  return { code: serverCode || 'http_error', message: `预览请求失败（HTTP ${status}）。`, retryable: false };
}

export function describeAttachmentPreviewError(error: unknown): string {
  if (error instanceof Error && error.name === 'AttachmentPreviewError') return error.message;
  return '附件下载或本地保存失败，请检查网络与可用存储后重试。';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
