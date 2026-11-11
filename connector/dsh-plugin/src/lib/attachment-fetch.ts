import { createHash } from 'node:crypto';
import type { FileBaseline } from './attachment-policy.js';
import {
  ATTACHMENT_ERROR_CHANGED,
  ATTACHMENT_ERROR_DENIED,
  ATTACHMENT_ERROR_FAILED,
  ATTACHMENT_ERROR_TOO_LARGE,
  ATTACHMENT_ERROR_UNAVAILABLE,
  ATTACHMENT_ERROR_UNKNOWN,
  baselineMatches,
  isSensitivePath,
  readBaseline,
} from './attachment-policy.js';
import type { AttachmentIndex, StoredDeclaration, StoredMessageDeclaration } from './attachment-index.js';
import { protocolError } from './request-cache.js';

export interface AttachmentReadRequest {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly path: string;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

/** Reads bytes through the DSH workspace-files service, not raw `fs`. */
export type AttachmentByteReader = (request: AttachmentReadRequest) => Promise<Uint8Array>;

export interface AttachmentUploadRequest {
  readonly attachmentId: string;
  readonly sessionId: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly signal: AbortSignal;
}

export type AttachmentUploader = (request: AttachmentUploadRequest) => Promise<void>;

export type MessageAttachmentByteReader = (request: {
  readonly sessionId: string;
  readonly declaration: StoredMessageDeclaration;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}) => Promise<Uint8Array>;

export interface AttachmentFetchResult {
  readonly status: 'ready';
  readonly bytes: number;
  readonly sha256: string;
  readonly mime: string;
}

export interface AttachmentFetcherOptions {
  readonly index: AttachmentIndex;
  readonly readBytes: AttachmentByteReader;
  readonly readMessage?: MessageAttachmentByteReader;
  readonly upload: AttachmentUploader;
  readonly maxBytes: number;
  readonly resolveWorkspaceRoot: (sessionId: string, workspaceId: string) => string;
  readonly stat?: (path: string) => Promise<FileBaseline>;
}

/**
 * Serves one `session.attachment.fetch`.
 *
 * The Connector re-stats the file before reading and refuses to send anything
 * that changed after the declaration, so a model cannot declare a harmless file
 * and have a different one uploaded later. Concurrent fetches of the same id
 * share one read and one upload.
 */
export class AttachmentFetcher {
  readonly #index: AttachmentIndex;
  readonly #readBytes: AttachmentByteReader;
  readonly #readMessage: MessageAttachmentByteReader | undefined;
  readonly #upload: AttachmentUploader;
  readonly #maxBytes: number;
  readonly #resolveWorkspaceRoot: (sessionId: string, workspaceId: string) => string;
  readonly #stat: (path: string) => Promise<FileBaseline>;
  readonly #inFlight = new Map<string, Promise<AttachmentFetchResult>>();

  constructor({ index, readBytes, readMessage, upload, maxBytes, resolveWorkspaceRoot, stat = readBaseline }: AttachmentFetcherOptions) {
    this.#index = index;
    this.#readBytes = readBytes;
    this.#readMessage = readMessage;
    this.#upload = upload;
    this.#maxBytes = maxBytes;
    this.#resolveWorkspaceRoot = resolveWorkspaceRoot;
    this.#stat = stat;
  }

  async fetch(
    params: { readonly sessionId: string; readonly attachmentId: string },
    { signal }: { readonly signal: AbortSignal },
  ): Promise<AttachmentFetchResult> {
    const existing = this.#inFlight.get(params.attachmentId);
    if (existing) return existing;
    const pending = this.#run(params, signal).finally(() => {
      this.#inFlight.delete(params.attachmentId);
    });
    this.#inFlight.set(params.attachmentId, pending);
    return pending;
  }

  async #run(
    params: { readonly sessionId: string; readonly attachmentId: string },
    signal: AbortSignal,
  ): Promise<AttachmentFetchResult> {
    const declaration = this.#index.get(params.sessionId, params.attachmentId);
    if (!declaration) {
      throw protocolError(ATTACHMENT_ERROR_UNKNOWN, 'This attachment was never declared in this session');
    }
    if (declaration.source === 'message') {
      return this.#runMessage(params.sessionId, declaration, signal);
    }
    if (isSensitivePath(declaration.path)) {
      throw protocolError(ATTACHMENT_ERROR_DENIED, 'This attachment matches the sensitive-name list');
    }
    const current = await this.#stat(declaration.path).catch(() => null);
    if (!current) {
      throw protocolError(ATTACHMENT_ERROR_UNAVAILABLE, 'The declared file is missing or unreadable');
    }
    if (!baselineMatches(current, declaration.baseline)) {
      throw protocolError(ATTACHMENT_ERROR_CHANGED, 'The declared file changed after it was declared');
    }
    if (current.size > this.#maxBytes) {
      throw protocolError(ATTACHMENT_ERROR_TOO_LARGE, 'The declared file exceeds the attachment size limit');
    }
    let data: Uint8Array;
    try {
      data = await this.#readBytes({
        sessionId: params.sessionId,
        workspaceRoot: this.#resolveWorkspaceRoot(params.sessionId, declaration.workspaceId),
        path: declaration.path,
        maxBytes: this.#maxBytes,
        signal,
      });
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === ATTACHMENT_ERROR_TOO_LARGE || code === ATTACHMENT_ERROR_UNAVAILABLE
        || code === ATTACHMENT_ERROR_CHANGED || code === ATTACHMENT_ERROR_DENIED
        || code === ATTACHMENT_ERROR_FAILED) {
        throw error;
      }
      if (code === 'workspace-file/too-large') {
        throw protocolError(ATTACHMENT_ERROR_TOO_LARGE, 'The Host file limit rejected this attachment');
      }
      if (code?.startsWith('workspace-file/')) {
        throw protocolError(ATTACHMENT_ERROR_UNAVAILABLE, 'The desktop could not read the declared file');
      }
      throw protocolError(ATTACHMENT_ERROR_FAILED, 'The desktop read failed; try the attachment again', true);
    }
    if (data.byteLength > this.#maxBytes) {
      throw protocolError(ATTACHMENT_ERROR_TOO_LARGE, 'The declared file exceeds the attachment size limit');
    }
    if (data.byteLength !== declaration.bytes) {
      // A size mismatch means the file moved under us even if the stat matched.
      throw protocolError(ATTACHMENT_ERROR_CHANGED, 'The declared file changed after it was declared');
    }
    return this.#storeBytes(declaration, params.sessionId, data, signal);
  }

  async #runMessage(
    sessionId: string,
    declaration: StoredMessageDeclaration,
    signal: AbortSignal,
  ): Promise<AttachmentFetchResult> {
    if (declaration.bytes > this.#maxBytes) {
      throw protocolError(ATTACHMENT_ERROR_TOO_LARGE, 'The declared file exceeds the attachment size limit');
    }
    if (!this.#readMessage) {
      throw protocolError(ATTACHMENT_ERROR_UNAVAILABLE, 'This Host cannot read persisted message attachments');
    }
    let data: Uint8Array;
    try {
      data = await this.#readMessage({ sessionId, declaration, maxBytes: this.#maxBytes, signal });
    } catch (error) {
      if (errorCodeOf(error) === ATTACHMENT_ERROR_TOO_LARGE) {
        throw protocolError(ATTACHMENT_ERROR_TOO_LARGE, 'The attachment exceeds the configured size limit');
      }
      throw protocolError(ATTACHMENT_ERROR_FAILED, errorMessageOf(error, 'Could not read the message attachment'), true);
    }
    if (data.byteLength > this.#maxBytes) {
      throw protocolError(ATTACHMENT_ERROR_TOO_LARGE, 'The attachment exceeds the configured size limit');
    }
    if (data.byteLength !== declaration.bytes) {
      throw protocolError(ATTACHMENT_ERROR_CHANGED, 'The attachment bytes do not match the persisted reference');
    }
    return this.#storeBytes(declaration, sessionId, data, signal);
  }

  async #storeBytes(
    declaration: StoredDeclaration,
    sessionId: string,
    data: Uint8Array,
    signal: AbortSignal,
  ): Promise<AttachmentFetchResult> {
    const digest = createHash('sha256').update(data).digest('hex');
    try {
      await this.#upload({
        attachmentId: declaration.attachmentId,
        sessionId,
        bytes: data,
        sha256: digest,
        signal,
      });
    } catch (error) {
      throw protocolError(ATTACHMENT_ERROR_FAILED, errorMessageOf(error, 'Could not upload the attachment bytes'));
    }
    return { status: 'ready', bytes: data.byteLength, sha256: digest, mime: declaration.mime };
  }
}

/** Best-effort MIME guess from the display name; the Server sniffs the bytes. */
export function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'text/plain';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

export function guessKind(mime: string): 'image' | 'file' {
  return mime.startsWith('image/') ? 'image' : 'file';
}

export type { StoredDeclaration };

function errorCodeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
