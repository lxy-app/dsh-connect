import type { HostFileUploads, HostPromptContentPart } from '../host-api.js';
import type { PromptAttachmentInput, PromptRequestInput } from './input-validation.js';
import { protocolError } from './request-cache.js';
import { isRecord } from '../types.js';

/** Downloads one Server attachment by its opaque id into raw bytes. */
export type AttachmentByteDownloader = (request: {
  readonly attachmentId: string;
  readonly signal: AbortSignal;
}) => Promise<Uint8Array>;

export interface PromptAttachmentAdmission {
  /** Host prompt content: text inline, each attachment as a staged receipt. */
  readonly content: readonly HostPromptContentPart[];
  /** Ids admitted during this call, so a failed prompt can be retried cleanly. */
  readonly admittedIds: readonly string[];
}

export interface PromptAttachmentAdmitterOptions {
  readonly uploads: HostFileUploads | undefined;
  readonly download: AttachmentByteDownloader;
}

/**
 * Turns Server-verified attachment ids into DSH prompt parts.
 *
 * The Server has already checked that each id belongs to this phone, Session and
 * workspace; the Connector's job is only to fetch those bytes and stage them
 * through the Host upload service. DSH then stores them and mints a receipt, so
 * the prompt cites staged bytes rather than a path or a URL.
 */
export class PromptAttachmentAdmitter {
  readonly #uploads: HostFileUploads | undefined;
  readonly #download: AttachmentByteDownloader;

  constructor({ uploads, download }: PromptAttachmentAdmitterOptions) {
    this.#uploads = uploads;
    this.#download = download;
  }

  get available(): boolean {
    return this.#uploads !== undefined;
  }

  async admit(
    request: PromptRequestInput,
    signal: AbortSignal,
  ): Promise<PromptAttachmentAdmission> {
    const attachments = request.attachments ?? [];
    if (attachments.length === 0) {
      return { content: this.#textContent(request), admittedIds: [] };
    }
    const uploads = this.#uploads;
    if (uploads === undefined) {
      throw protocolError(
        'unsupported_method',
        'This DSH Host does not expose the file upload service; update DeepSeek Harness to send attachments.',
      );
    }
    const staged = new Map<string, string>();
    for (const attachment of attachments) {
      signal.throwIfAborted();
      staged.set(attachment.attachmentId, await this.#stage(uploads, request.sessionId, attachment, signal));
    }
    const content = request.content.map((part): HostPromptContentPart => {
      if (part.type === 'text') return part;
      const receiptId = staged.get(part.attachmentId);
      if (receiptId === undefined) {
        throw protocolError('invalid_request', `Attachment ${part.attachmentId} was not admitted`);
      }
      return { type: 'file', receiptId };
    });
    return { content, admittedIds: [...staged.keys()] };
  }

  async #stage(
    uploads: HostFileUploads,
    sessionId: string,
    attachment: PromptAttachmentInput,
    signal: AbortSignal,
  ): Promise<string> {
    const bytes = await this.#download({ attachmentId: attachment.attachmentId, signal });
    if (bytes.byteLength === 0) {
      throw protocolError('invalid_request', `Attachment ${attachment.attachmentId} is empty`);
    }
    const mediaType = hostImageMediaType(attachment)
      ?? (attachment.type === 'image' ? detectImageMediaType(bytes) : undefined);
    if (attachment.type === 'image' && mediaType === undefined) {
      throw protocolError('attachment_denied', `Could not determine the image type for ${attachment.attachmentId}`);
    }
    if (mediaType !== undefined && uploads.uploadImageStream === undefined) {
      throw protocolError('unsupported_method', 'This DSH Host cannot upload prompt images; update DeepSeek Harness.');
    }
    let receiptId: unknown;
    try {
      const name = displayNameOf(attachment);
      // DSH resolves both services' receipts through a file prompt part. Never
      // silently downgrade an image to the generic file service.
      const value: unknown = mediaType !== undefined
        ? await uploads.uploadImageStream!({ sessionId, data: chunk(bytes), signal, name, mediaType })
        : await uploads.uploadStream({ sessionId, data: chunk(bytes), signal, name });
      receiptId = isRecord(value) ? value.receiptId : undefined;
    } catch (cause) {
      throw attachmentAdmissionError(attachment, cause);
    }
    if (typeof receiptId !== 'string' || receiptId.length === 0) {
      throw protocolError('attachment_denied', `The Host refused attachment ${attachment.attachmentId}`);
    }
    return receiptId;
  }

  #textContent(request: PromptRequestInput): readonly HostPromptContentPart[] {
    return request.content.map((part): HostPromptContentPart => {
      if (part.type !== 'text') {
        throw protocolError('invalid_request', 'Attachment parts require an attachment list');
      }
      return part;
    });
  }
}

/** Yields one chunk; the Host upload service accepts any async iterable. */
async function* chunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/** Prefer the Server-verified display name; older Servers fall back to the id. */
function displayNameOf(attachment: PromptAttachmentInput): string {
  return attachment.name ?? attachment.attachmentId;
}

function hostImageMediaType(
  attachment: PromptAttachmentInput,
): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined {
  if (attachment.type !== 'image') return undefined;
  switch (attachment.mime) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return attachment.mime;
    default:
      return undefined;
  }
}

function detectImageMediaType(
  bytes: Uint8Array,
): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined {
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (matches(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  const signature = ascii(bytes, 0, 6);
  if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  return undefined;
}

function matches(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.byteLength < offset + length) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function attachmentAdmissionError(attachment: PromptAttachmentInput, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  return protocolError('attachment_denied', `The Host could not stage attachment ${attachment.attachmentId}: ${message}`);
}