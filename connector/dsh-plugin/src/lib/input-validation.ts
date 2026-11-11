import type { SessionAddress, SessionPageRequest, TurnWindow } from '../host-api.js';
import { isRecord } from '../types.js';
import { protocolError } from './request-cache.js';

export interface PromptInputParams {
  readonly sessionId: unknown;
  readonly mode?: 'queue' | 'steer';
  readonly content?: unknown;
  readonly clientTimeZone?: string;
}

export interface PageInputParams {
  readonly sessionId: unknown;
  readonly throughSeq?: unknown;
  readonly beforeSeq?: unknown;
  readonly cursor?: unknown;
  readonly maxMessages?: unknown;
  readonly limit?: unknown;
  readonly turnWindow?: TurnWindow;
}

export function sessionAddress(sessionId: unknown): SessionAddress {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw protocolError('invalid_request', 'sessionId is required');
  }
  return { kind: 'session', sessionId };
}

export interface PromptContentInput {
  readonly type: 'text';
  readonly text: string;
}

/** One attachment reference the Server verified before forwarding the prompt. */
export interface PromptAttachmentInput {
  readonly type: 'image' | 'file';
  readonly attachmentId: string;
}

/** One Host prompt content part: text stays inline, attachments cite an id. */
export type PromptPartInput =
  | PromptContentInput
  | { readonly type: 'image' | 'file'; readonly attachmentId: string };

/** Connector-side prompt request, still carrying attachment ids for admission. */
export interface PromptRequestInput {
  readonly requestId: string;
  readonly sessionId: string;
  readonly mode: 'queue' | 'steer';
  readonly content: readonly PromptPartInput[];
  readonly attachments?: readonly PromptAttachmentInput[];
  readonly clientTimeZone?: string;
}

export function promptInput(params: PromptInputParams, requestId: string): PromptRequestInput {
  if (params.mode !== undefined && params.mode !== 'queue' && params.mode !== 'steer') {
    throw protocolError('invalid_request', 'mode must be queue or steer');
  }
  if (!Array.isArray(params.content) || params.content.length === 0) {
    throw protocolError('invalid_request', 'At least one prompt content part is required');
  }
  const content = params.content.map((part: unknown): PromptPartInput => {
    if (!isRecord(part) || typeof part.type !== 'string') {
      throw protocolError('unsupported_content', 'Prompt content parts must be text or an attachment');
    }
    if (part.type === 'text') {
      if (typeof part.text !== 'string' || !part.text.trim()) {
        throw protocolError('unsupported_content', 'Text prompt parts must carry non-empty text');
      }
      return { type: 'text', text: part.text };
    }
    if (part.type === 'image' || part.type === 'file') {
      if (typeof part.attachmentId !== 'string' || !part.attachmentId.trim()) {
        throw protocolError('unsupported_content', 'Attachment parts must carry an attachmentId');
      }
      return { type: part.type, attachmentId: part.attachmentId };
    }
    throw protocolError('unsupported_content', 'Prompt content parts must be text or an attachment');
  });
  if (!content.some((part) => part.type === 'text')) {
    throw protocolError('invalid_request', 'At least one text prompt part is required');
  }
  const textBytes = content.reduce(
    (total, part) => total + (part.type === 'text' ? Buffer.byteLength(part.text) : 0),
    0,
  );
  if (textBytes > 64 * 1024) {
    throw protocolError('payload_too_large', 'Text prompts are limited to 64 KiB');
  }
  const attachments = content.filter((part): part is PromptAttachmentInput => part.type !== 'text');
  const hostContent = content.map((part) => (part.type === 'text' ? part : { type: part.type, attachmentId: part.attachmentId }));
  return {
    requestId,
    sessionId: sessionAddress(params.sessionId).sessionId,
    mode: params.mode ?? 'queue',
    content: hostContent,
    ...(attachments.length === 0 ? {} : { attachments }),
    clientTimeZone: params.clientTimeZone ?? 'UTC',
  };
}

export function pageInput(params: PageInputParams): SessionPageRequest {
  const throughSeq = nonNegativeInteger(params.throughSeq ?? -1, 'throughSeq', -1);
  const input: {
    address: SessionAddress;
    throughSeq: number;
    maxMessages: number;
    beforeSeq?: number;
    turnWindow?: TurnWindow;
  } = {
    address: sessionAddress(params.sessionId),
    throughSeq,
    maxMessages: Math.min(200, Math.max(1, Number(params.maxMessages ?? params.limit ?? 50))),
  };
  if (!Number.isSafeInteger(input.maxMessages)) {
    throw protocolError('invalid_request', 'maxMessages must be an integer');
  }
  const beforeSeq = params.beforeSeq ?? params.cursor;
  if (beforeSeq !== undefined) {
    input.beforeSeq = nonNegativeInteger(beforeSeq, 'beforeSeq');
  }
  if (params.turnWindow !== undefined) input.turnWindow = params.turnWindow;
  return input;
}

export interface SessionModelCatalogInputParams {
  readonly sessionId: unknown;
  readonly workspaceId: unknown;
}

export interface SessionModelSelectInputParams extends SessionModelCatalogInputParams {
  readonly provider: unknown;
  readonly model: unknown;
  readonly reasoningEffort?: unknown;
}

export function modelCatalogInput(params: SessionModelCatalogInputParams): {
  readonly sessionId: string;
  readonly workspaceId: string;
} {
  assertAllowedKeys(params, ['sessionId', 'workspaceId']);
  return {
    sessionId: sessionAddress(params.sessionId).sessionId,
    workspaceId: requiredText(params.workspaceId, 'workspaceId', 128),
  };
}

export function modelSelectInput(params: SessionModelSelectInputParams): {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
} {
  assertAllowedKeys(params, ['sessionId', 'workspaceId', 'provider', 'model', 'reasoningEffort']);
  return {
    sessionId: sessionAddress(params.sessionId).sessionId,
    workspaceId: requiredText(params.workspaceId, 'workspaceId', 128),
    provider: requiredText(params.provider, 'provider', 128),
    model: requiredText(params.model, 'model', 256),
    ...params.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: requiredText(params.reasoningEffort, 'reasoningEffort', 64) },
  };
}

function assertAllowedKeys(value: unknown, allowed: readonly string[]): void {
  if (!isRecord(value)) throw protocolError('invalid_request', 'command params must be an object');
  const accepted = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !accepted.has(key));
  if (unknown !== undefined) throw protocolError('invalid_request', `Unsupported parameter: ${unknown}`);
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw protocolError('invalid_request', `${name} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string, minimum = 0): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw protocolError('invalid_request', `${name} must be a safe integer greater than or equal to ${minimum}`);
  }
  return number;
}
