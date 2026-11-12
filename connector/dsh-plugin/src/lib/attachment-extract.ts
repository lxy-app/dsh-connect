import { createHash } from 'node:crypto';

/** Tool names whose `arguments.path` may name a deliverable. */
export const DEFAULT_TOOL_ALLOWLIST: readonly string[] = ['dsh_im_return_file'];

export interface AttachmentCandidate {
  readonly attachmentId: string;
  readonly seq: number;
  readonly turn: number;
  readonly index: number;
  readonly source: 'deliverable' | 'tool';
  /** Desktop-only; never leaves the Connector. */
  readonly path: string;
  readonly name: string;
  readonly description?: string;
  readonly occurredAt: string;
}

export interface ExtractOptions {
  readonly sessionId: string;
  readonly toolAllowlist?: readonly string[];
  /** Cut every candidate whose seq is below this cursor. */
  readonly minimumSeq?: number;
}

export type MessageAttachmentReference =
  | {
      readonly attachmentId: string;
      readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
      readonly bytes: number;
      readonly width: number;
      readonly height: number;
      readonly name?: string;
    }
  | {
      readonly attachmentId: string;
      readonly name: string;
      readonly bytes: number;
    };

/** One immutable DSH attachment learned from a persisted user message. */
export interface MessageAttachmentCandidate {
  readonly attachmentId: string;
  readonly source: 'message';
  readonly seq: number;
  readonly index: number;
  readonly reference: MessageAttachmentReference;
  readonly kind: 'image' | 'file';
  readonly name: string;
  readonly mime: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
}

interface RawRecord {
  readonly event: {
    readonly type: string;
    readonly seq: unknown;
    readonly time: unknown;
    readonly data: unknown;
  };
}

/**
 * Derives attachment declarations from DSH session events.
 *
 * Two sources are supported in M1: `deliverables/presented` (the `present`
 * tool) and an allowlisted tool family whose successful call carries a `path`
 * argument (the IM channel's return-file tool). Message attachment blocks stay
 * for M3 because they need the DSH attachment service to resolve bytes.
 */
export function extractAttachmentCandidates(records: readonly RawRecord[], options: ExtractOptions): AttachmentCandidate[] {
  const allowlist = new Set(options.toolAllowlist ?? DEFAULT_TOOL_ALLOWLIST);
  const calls = new Map<string, { readonly path: string; readonly turn: number }>();
  const candidates: AttachmentCandidate[] = [];
  let currentTurn = 0;
  let nextTurn = 1;

  for (const record of records) {
    const event = record.event;
    const seq = Number(event.seq);
    if (!Number.isSafeInteger(seq)) continue;
    if (options.minimumSeq !== undefined && seq < options.minimumSeq) continue;
    const data = isRecord(event.data) ? event.data : {};

    if (event.type === 'turn/start') {
      const declaredTurn = typeof data.turn === 'number' ? data.turn : 0;
      currentTurn = Number.isSafeInteger(declaredTurn) && declaredTurn > 0 ? declaredTurn : nextTurn;
      nextTurn = Math.max(nextTurn, currentTurn + 1);
      continue;
    }

    if (event.type === 'deliverables/presented') {
      const turn = Number(data.turn);
      const files = Array.isArray(data.files) ? data.files : [];
      files.forEach((file, index) => {
        if (!isRecord(file) || typeof file.path !== 'string' || file.path.length === 0) return;
        candidates.push(candidate({
          sessionId: options.sessionId,
          seq,
          turn: Number.isSafeInteger(turn) ? turn : 0,
          index,
          source: 'deliverable',
          path: file.path,
          occurredAt: eventTime(event.time),
          description: typeof file.description === 'string' ? file.description : undefined,
        }));
      });
      continue;
    }

    // The IM channel registers returned files only in its own memory, so the
    // tool call/result pair is the only place the path appears.
    if (event.type === 'tool/call') {
      const name = typeof data.name === 'string' ? data.name : '';
      if (!allowlist.has(name)) continue;
      const callId = typeof data.callId === 'string' ? data.callId : undefined;
      const path = pathFromArguments(data.arguments);
      if (callId && path) calls.set(callId, { path, turn: currentTurn });
      continue;
    }
    if (event.type === 'tool/result') {
      const message = isRecord(data.message) ? data.message : data;
      const callId = typeof message.toolCallId === 'string' ? message.toolCallId : undefined;
      if (!callId || message.isError === true) continue;
      const call = calls.get(callId);
      if (!call) continue;
      calls.delete(callId);
      candidates.push(candidate({
        sessionId: options.sessionId,
        seq,
        turn: call.turn,
        index: 0,
        source: 'tool',
        path: call.path,
        occurredAt: eventTime(event.time),
      }));
    }
  }
  return candidates;
}

/**
 * Reads durable image/file blocks from one persisted user message. The mobile
 * id is derived from the Session coordinates; DSH's sha256 ref stays private
 * to the Connector and is only used by the Host attachment service.
 */
export function extractMessageAttachmentCandidates(
  message: unknown,
  options: { readonly sessionId: string; readonly seq: number },
): MessageAttachmentCandidate[] {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  const candidates: MessageAttachmentCandidate[] = [];
  message.content.forEach((block, index) => {
    if (!isRecord(block) || (block.type !== 'image' && block.type !== 'file') || !isRecord(block.attachment)) return;
    const ref = block.attachment;
    if (typeof ref.attachmentId !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(ref.attachmentId)) return;
    if (!validByteLength(ref.bytes)) return;
    const base = {
      attachmentId: attachmentID(options.sessionId, 'message', options.seq, index),
      source: 'message' as const,
      seq: options.seq,
      index,
      bytes: ref.bytes,
    };
    if (block.type === 'image') {
      if (!isImageMediaType(ref.mediaType) || !validDimension(ref.width) || !validDimension(ref.height)) return;
      const reference = {
        attachmentId: ref.attachmentId,
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
        ...typeof ref.name === 'string' && ref.name.trim() ? { name: displayNameOf(ref.name) } : {},
      };
      candidates.push({
        ...base,
        reference,
        kind: 'image',
        name: reference.name ?? '图片',
        mime: ref.mediaType,
        width: ref.width,
        height: ref.height,
      });
      return;
    }
    if (typeof ref.name !== 'string' || !ref.name.trim()) return;
    const name = displayNameOf(ref.name);
    candidates.push({
      ...base,
      reference: { attachmentId: ref.attachmentId, name, bytes: ref.bytes },
      kind: 'file',
      name,
      mime: guessMessageFileMime(name),
    });
  });
  return candidates;
}

function validByteLength(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isImageMediaType(value: unknown): value is 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif';
}

function guessMessageFileMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'text/plain';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

function candidate(input: {
  sessionId: string;
  seq: number;
  turn: number;
  index: number;
  source: 'deliverable' | 'tool';
  path: string;
  occurredAt: string;
  description?: string;
}): AttachmentCandidate {
  return {
    attachmentId: attachmentID(input.sessionId, input.source, input.seq, input.index),
    seq: input.seq,
    turn: input.turn,
    index: input.index,
    source: input.source,
    path: input.path,
    name: displayNameOf(input.path),
    occurredAt: input.occurredAt,
    ...(input.description ? { description: input.description } : {}),
  };
}

/**
 * `att_` + base64url(sha256(sessionId \0 source \0 seq \0 index))[:24].
 *
 * Deterministic so a file keeps its id across pagination, reconnects and
 * Connector restarts, and carries no path or name that could be reversed.
 */
export function attachmentID(sessionId: string, source: string, seq: number, index: number): string {
  const digest = createHash('sha256')
    .update(`${sessionId}\u0000${source}\u0000${seq}\u0000${index}`)
    .digest('base64url');
  return `att_${digest.slice(0, 24)}`;
}

function eventTime(value: unknown): string {
  const millis = typeof value === 'number' ? value : Date.parse(String(value));
  return new Date(Number.isFinite(millis) ? millis : Date.now()).toISOString();
}

function displayNameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  return name.length > 0 ? name : 'file';
}

function pathFromArguments(value: unknown): string | undefined {
  const argumentsValue = typeof value === 'string' ? safeParse(value) : value;
  if (!isRecord(argumentsValue)) return undefined;
  return typeof argumentsValue.path === 'string' && argumentsValue.path.length > 0 ? argumentsValue.path : undefined;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
