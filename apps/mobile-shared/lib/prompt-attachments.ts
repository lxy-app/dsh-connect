/**
 * Prompt attachment rules shared by both mobile shells.
 *
 * A draft attachment is a local file the user picked but has not sent yet. The
 * limits mirror the protocol schema (six parts, 20 MiB each) so the App refuses
 * an oversized pick before uploading anything.
 */

export const MAX_PROMPT_ATTACHMENTS = 6;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** One picked file staged in the composer before sending. */
export type PromptAttachmentDraft = {
  /** Local identity only; replaced by the Server id after upload. */
  localId: string;
  kind: 'image' | 'file';
  name: string;
  mime: string;
  bytes: number;
  /** Local file URI used for the preview and the upload. */
  uri: string;
  /** Server id once the bytes were staged; absent while still local. */
  attachmentId?: string;
  state: 'local' | 'uploading' | 'ready' | 'failed';
  /** Stable message shown when state is "failed". */
  error?: string;
};

export type PromptAttachmentLimits = {
  readonly maxCount: number;
  readonly maxBytes: number;
};

export const DEFAULT_ATTACHMENT_LIMITS: PromptAttachmentLimits = {
  maxCount: MAX_PROMPT_ATTACHMENTS,
  maxBytes: MAX_ATTACHMENT_BYTES,
};

/** Result of trying to add one pick: accepted draft or a user-facing reason. */
export type AttachmentAdmission =
  | { readonly ok: true; readonly draft: PromptAttachmentDraft }
  | { readonly ok: false; readonly reason: string };

let draftCounter = 0;

/** Creates a local draft with a stable id for React keys. */
export function createAttachmentDraft(input: {
  readonly kind: 'image' | 'file';
  readonly name: string;
  readonly mime?: string;
  readonly bytes?: number;
  readonly uri: string;
}): PromptAttachmentDraft {
  draftCounter += 1;
  return {
    localId: `draft_${Date.now().toString(36)}_${draftCounter.toString(36)}`,
    kind: input.kind,
    name: displayName(input.name, input.kind),
    mime: normalizeMime(input.mime, input.kind, input.name),
    bytes: Number.isFinite(input.bytes) && (input.bytes ?? 0) > 0 ? Number(input.bytes) : 0,
    uri: input.uri,
    state: 'local',
  };
}

/**
 * Validates one pick against the limits and the drafts already staged.
 * Duplicate names are refused so the same file is not sent twice by accident.
 */
export function admitAttachment(
  draft: PromptAttachmentDraft,
  existing: readonly PromptAttachmentDraft[],
  limits: PromptAttachmentLimits = DEFAULT_ATTACHMENT_LIMITS,
): AttachmentAdmission {
  if (existing.length >= limits.maxCount) {
    return { ok: false, reason: `每条消息最多添加 ${limits.maxCount} 个附件` };
  }
  if (draft.bytes > limits.maxBytes) {
    return { ok: false, reason: `${draft.name} 超过 ${formatBytes(limits.maxBytes)} 上限` };
  }
  if (existing.some((item) => item.name === draft.name && item.bytes === draft.bytes)) {
    return { ok: false, reason: `${draft.name} 已在待发送附件中` };
  }
  return { ok: true, draft };
}

/** Whether the composer may send: text alone, attachments alone, both. */
export function canSubmitPrompt(draft: string, attachments: readonly PromptAttachmentDraft[]): boolean {
  return draft.trim().length > 0 || attachments.length > 0;
}

/** A prompt is only sent once every attachment is staged on the Server. */
export function readyToSend(attachments: readonly PromptAttachmentDraft[]): boolean {
  return attachments.every((item) => item.state === 'ready' && item.attachmentId !== undefined);
}

/** Ids in composer order, which is the order the Server forwards them. */
export function attachmentIds(attachments: readonly PromptAttachmentDraft[]): string[] {
  return attachments
    .map((item) => item.attachmentId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** The Server accepts image/* only through the image part; everything else is a file. */
export function isImageMime(mime: string): boolean {
  return /^image\/(png|jpe?g|webp|gif)$/i.test(mime.trim());
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) {
    const value = bytes / (1024 * 1024);
    return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Maps one failed attachment to the banner text shown above the composer. */
export function attachmentFailureSummary(attachments: readonly PromptAttachmentDraft[]): string | null {
  const failed = attachments.filter((item) => item.state === 'failed');
  if (failed.length === 0) return null;
  return failed.length === 1 ? `${failed[0]?.name ?? '附件'} 上传失败，可单独重试` : `${failed.length} 个附件上传失败，可单独重试`;
}

function displayName(name: string, kind: 'image' | 'file'): string {
  const trimmed = name.trim().replace(/[\\/]+/g, '').replace(/^\.+/, '');
  if (trimmed.length > 0) return trimmed.slice(0, 256);
  return kind === 'image' ? '图片' : '附件';
}

function normalizeMime(mime: string | undefined, kind: 'image' | 'file', name: string): string {
  const declared = (mime ?? '').trim().toLowerCase();
  if (declared.length > 0 && declared.includes('/')) return declared;
  if (kind === 'image') {
    const extension = name.toLowerCase().split('.').pop() ?? '';
    if (extension === 'png') return 'image/png';
    if (extension === 'gif') return 'image/gif';
    if (extension === 'webp') return 'image/webp';
    return 'image/jpeg';
  }
  return 'application/octet-stream';
}