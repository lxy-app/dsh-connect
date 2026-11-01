import type { SessionAddress, SessionPageRequest, SessionPromptRequest, TurnWindow } from '../host-api.js';
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

export function promptInput(params: PromptInputParams, requestId: string): SessionPromptRequest {
  if (params.mode !== undefined && params.mode !== 'queue' && params.mode !== 'steer') {
    throw protocolError('invalid_request', 'mode must be queue or steer');
  }
  if (!Array.isArray(params.content) || params.content.length === 0) {
    throw protocolError('invalid_request', 'At least one prompt content part is required');
  }
  const content = params.content.map((part: unknown) => {
    if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string' || !part.text.trim()) {
      throw protocolError('unsupported_content', 'P0 connectors accept non-empty text prompt parts only');
    }
    return { type: 'text' as const, text: part.text };
  });
  const textBytes = content.reduce((total, part) => total + Buffer.byteLength(part.text), 0);
  if (textBytes > 64 * 1024) {
    throw protocolError('payload_too_large', 'Text prompts are limited to 64 KiB');
  }
  return {
    requestId,
    sessionId: sessionAddress(params.sessionId).sessionId,
    mode: params.mode ?? 'queue',
    content,
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

function nonNegativeInteger(value: unknown, name: string, minimum = 0): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw protocolError('invalid_request', `${name} must be a safe integer greater than or equal to ${minimum}`);
  }
  return number;
}
