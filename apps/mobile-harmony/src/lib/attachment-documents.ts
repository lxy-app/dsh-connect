import { buildAttachmentUrl, normalizeServerUrl } from '@/lib/mobile-api';
import type { MobileAttachment } from '@shared/types/mobile';

export type AttachmentDocumentKind = 'markdown' | 'text' | 'pdf';
export type AttachmentDocumentPending = {
  readonly state: 'fetching' | 'converting';
  readonly retryAfterMs?: number;
};

export const ATTACHMENT_DOCUMENT_PENDING_MAX_ATTEMPTS = 121;
export const ATTACHMENT_DOCUMENT_PENDING_TIMEOUT_MS = 120_000;
export const ATTACHMENT_DOCUMENT_DEFAULT_RETRY_MS = 1_000;
export const ATTACHMENT_DOCUMENT_MAX_RETRY_MS = 5_000;
export const ATTACHMENT_DOCUMENT_TEXT_MAX_BYTES = 2 * 1024 * 1024;
export const ATTACHMENT_DOCUMENT_PDF_MAX_BYTES = 50 * 1024 * 1024;

const OPAQUE_ATTACHMENT_ID = /^att_[A-Za-z0-9_-]{8,64}$/;
const EXTENSIONS: Readonly<Record<string, AttachmentDocumentKind>> = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  json: 'text',
  log: 'text',
  html: 'text',
  htm: 'text',
  pdf: 'pdf',
  doc: 'pdf',
  docx: 'pdf',
  ppt: 'pdf',
  pptx: 'pdf',
  xls: 'pdf',
  xlsx: 'pdf',
};
const MARKDOWN_MIMES: ReadonlySet<string> = new Set(['text/markdown', 'text/x-markdown']);
const TEXT_MIMES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/html',
  'application/json',
  'text/json',
  'application/x-json',
  'application/log',
  'text/log',
  'text/x-log',
]);
const OFFICE_MIMES: ReadonlySet<string> = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const GENERIC_MIMES: ReadonlySet<string> = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const OFFICE_EXTENSIONS: ReadonlySet<string> = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']);
const HTML_EXTENSIONS: ReadonlySet<string> = new Set(['html', 'htm']);

/** Explicit MIME is authoritative; extensions refine only plain/generic metadata. */
export function attachmentDocumentKind(
  attachment: Pick<MobileAttachment, 'name' | 'mime'>,
): AttachmentDocumentKind | null {
  const mime = normalizedMime(attachment.mime);
  if (MARKDOWN_MIMES.has(mime)) return 'markdown';
  if (mime === 'application/pdf' || OFFICE_MIMES.has(mime)) return 'pdf';
  const fromName = EXTENSIONS[extensionOf(attachment.name)];
  if (mime === 'text/plain' && fromName === 'markdown') return 'markdown';
  if (TEXT_MIMES.has(mime)) return 'text';
  if (GENERIC_MIMES.has(mime)) return fromName ?? null;
  return null;
}

/** HTML is source text only; it must never be routed to a WebView or Markdown renderer. */
export function isHtmlAttachment(attachment: Pick<MobileAttachment, 'name' | 'mime'>): boolean {
  if (attachmentDocumentKind(attachment) !== 'text') return false;
  return normalizedMime(attachment.mime) === 'text/html'
    || HTML_EXTENSIONS.has(extensionOf(attachment.name));
}

export function isOfficePdfPreview(attachment: Pick<MobileAttachment, 'name' | 'mime'>): boolean {
  if (attachmentDocumentKind(attachment) !== 'pdf') return false;
  const mime = normalizedMime(attachment.mime);
  if (OFFICE_MIMES.has(mime)) return true;
  return GENERIC_MIMES.has(mime) && OFFICE_EXTENSIONS.has(extensionOf(attachment.name));
}

export function isOpaqueAttachmentId(attachmentId: string): boolean {
  return OPAQUE_ATTACHMENT_ID.test(attachmentId);
}

/** Uses only the opaque id; a desktop path or ordinary link is never accepted. */
export function buildAttachmentDocumentUrl(
  serverUrl: string,
  attachmentId: string,
  kind: AttachmentDocumentKind,
): string {
  if (!isOpaqueAttachmentId(attachmentId)) throw new Error('附件标识无效。');
  const original = buildAttachmentUrl(serverUrl, attachmentId);
  return kind === 'pdf' ? `${original}/preview` : original;
}

/**
 * Produces a bounded filename without a token, server URL, original filename or
 * path. The server hash separates identities; login replacement also clears it.
 */
export function attachmentDocumentCacheKey(
  attachment: { readonly attachmentId: string; readonly bytes?: number; readonly sha256?: string },
  serverUrl: string,
  kind: AttachmentDocumentKind,
): string {
  if (!isOpaqueAttachmentId(attachment.attachmentId)) throw new Error('附件标识无效。');
  const serverHash = stableServerHash(normalizeServerUrl(serverUrl));
  // A known attachment can gain sha256 when it becomes ready. Keep the same
  // declaration on the same cache path instead of downloading it again.
  return `v1-${serverHash}-${attachment.attachmentId}-${kind}`;
}

export function parseAttachmentDocumentPending(body: string): AttachmentDocumentPending | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.state !== 'fetching' && record.state !== 'converting') return null;
  const retryAfterMs = typeof record.retryAfterMs === 'number'
    && Number.isFinite(record.retryAfterMs)
    && record.retryAfterMs >= 0
    ? record.retryAfterMs
    : undefined;
  return {
    state: record.state,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

/** Bounded by both 120 seconds and 121 attempts; normal 90-second conversions fit. */
export function attachmentDocumentRetryDelayMs(
  pending: AttachmentDocumentPending,
  attempt: number,
  elapsedMs: number,
): number | null {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt >= ATTACHMENT_DOCUMENT_PENDING_MAX_ATTEMPTS) {
    return null;
  }
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= ATTACHMENT_DOCUMENT_PENDING_TIMEOUT_MS) {
    return null;
  }
  const requested = pending.retryAfterMs ?? ATTACHMENT_DOCUMENT_DEFAULT_RETRY_MS;
  const delay = Math.min(ATTACHMENT_DOCUMENT_MAX_RETRY_MS, Math.max(250, requested));
  return Math.min(delay, ATTACHMENT_DOCUMENT_PENDING_TIMEOUT_MS - elapsedMs);
}

export function isAttachmentDocumentWithinLimit(byteLength: number, kind: AttachmentDocumentKind): boolean {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) return false;
  const limit = kind === 'pdf' ? ATTACHMENT_DOCUMENT_PDF_MAX_BYTES : ATTACHMENT_DOCUMENT_TEXT_MAX_BYTES;
  return byteLength <= limit;
}

export function normalizeAttachmentDocumentETag(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return /^"[a-f0-9]{64}"$/.test(normalized) ? normalized : null;
}

export function canServeCachedAttachmentDocument(status: number, hasValidCache: boolean): boolean {
  return status === 304 && hasValidCache;
}

export function hasExpectedOriginalByteLength(bytes: Uint8Array, expectedBytes: number): boolean {
  return Number.isSafeInteger(expectedBytes) && expectedBytes >= 0 && bytes.byteLength === expectedBytes;
}

export function hasPdfMagic(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 5
    && bytes[0] === 0x25 // %
    && bytes[1] === 0x50 // P
    && bytes[2] === 0x44 // D
    && bytes[3] === 0x46 // F
    && bytes[4] === 0x2d; // -
}

function normalizedMime(mime: string): string {
  return mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function extensionOf(name: string): string {
  const normalized = name.toLowerCase();
  const separator = normalized.lastIndexOf('.');
  return separator >= 0 ? normalized.slice(separator + 1) : '';
}

function stableServerHash(serverUrl: string): string {
  // Two independently seeded FNV-1a passes keep the key compact. This is a
  // filename identity, not a cryptographic authenticity check; bytes and PDF
  // magic are validated separately before a cache entry can be used.
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
