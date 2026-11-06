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
