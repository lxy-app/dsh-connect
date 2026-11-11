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
    let receiptId: unknown;
    try {
      const value: unknown = await uploads.uploadStream({
        sessionId,
        data: chunk(bytes),
        signal,
        name: displayNameOf(attachment),
      });
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

/** The Server never sends the display name with the prompt, so the id stands in. */
function displayNameOf(attachment: PromptAttachmentInput): string {
  return attachment.attachmentId;
}

function attachmentAdmissionError(attachment: PromptAttachmentInput, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  return protocolError('attachment_denied', `The Host could not stage attachment ${attachment.attachmentId}: ${message}`);
}