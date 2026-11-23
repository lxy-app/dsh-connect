import { createAttachmentDraft, type PromptAttachmentDraft } from '@shared/lib/prompt-attachments';
import { isExpoCompatibleFileUri } from '@/lib/attachment-cache-uri';

export type AttachmentPickResult =
  | { readonly kind: 'picked'; readonly drafts: readonly PromptAttachmentDraft[] }
  | { readonly kind: 'canceled' }
  | { readonly kind: 'denied'; readonly reason: string };

type NativePickedAsset = {
  readonly kind: 'image' | 'file';
  readonly name: string;
  readonly mime: string;
  readonly bytes: number;
  readonly uri: string;
};

/** Converts the native JSON boundary into the same drafts used by both shells. */
export function harmonyPickerPayloadToAttachmentPickResult(
  serialized: string,
  remainingSlots: number,
): AttachmentPickResult {
  if (remainingSlots <= 0) return { kind: 'denied', reason: '已达单条消息附件数量上限' };

  let payload: unknown;
  try {
    payload = JSON.parse(serialized);
  } catch {
    throw invalidPickerResult();
  }
  if (!isRecord(payload) || typeof payload.status !== 'string') throw invalidPickerResult();
  if (payload.status === 'cancelled') return { kind: 'canceled' };
  if (payload.status !== 'picked' || !Array.isArray(payload.assets)) throw invalidPickerResult();

  if (payload.assets.length === 0) return { kind: 'canceled' };
  const assets = payload.assets.slice(0, remainingSlots).map(parseAsset);
  return {
    kind: 'picked',
    drafts: assets.map((asset) => createAttachmentDraft(asset)),
  };
}

export function describeAttachmentPickerError(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  return '无法打开系统附件选择器，请稍后重试。';
}

function parseAsset(value: unknown): NativePickedAsset {
  if (!isRecord(value)) throw invalidPickerResult();
  if (value.kind !== 'image' && value.kind !== 'file') throw invalidPickerResult();
  if (typeof value.name !== 'string' || value.name.length === 0) throw invalidPickerResult();
  if (typeof value.mime !== 'string' || !value.mime.includes('/')) throw invalidPickerResult();
  if (typeof value.uri !== 'string' || !isExpoCompatibleFileUri(value.uri)) throw invalidPickerResult();
  if (typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    throw invalidPickerResult();
  }
  return {
    kind: value.kind,
    name: value.name,
    mime: value.mime,
    bytes: value.bytes,
    uri: value.uri,
  };
}

function invalidPickerResult(): Error {
  return new Error('系统附件选择器返回了无法识别的结果，请重新构建应用后重试。');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
