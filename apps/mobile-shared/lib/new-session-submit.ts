import type { MobileSessionCreateResult } from '../types/mobile';
import {
  attachmentIds,
  readyToSend,
  uploadPendingAttachments,
  type PromptAttachmentDraft,
} from './prompt-attachments';

/** Appends final ASR text without submitting or dropping an existing draft. */
export function appendNewSessionTranscript(current: string, transcript: string, maxLength = 500): string {
  const finalText = transcript.trim();
  if (!finalText) return current;
  return `${current.trim() ? `${current.trim()}\n` : ''}${finalText}`.slice(0, maxLength);
}

/** Uses the first filename as a useful fallback when the first prompt has no text. */
export function newSessionTitle(text: string, attachments: readonly PromptAttachmentDraft[]): string {
  const source = text.trim() || (attachments.length === 1 ? attachments[0]?.name ?? '图片任务' : `${attachments.length} 个附件的任务`);
  const normalized = source.replace(/\s+/g, ' ').trim();
  return normalized.length > 32 ? `${normalized.slice(0, 32)}…` : normalized;
}

/**
 * Runs the new-session first-prompt pipeline in protocol order.
 *
 * The caller owns request-id creation and retry identity. This helper guarantees
 * that a failed attachment never falls back to a text-only prompt, and that a
 * retry can reuse the already-created Session plus any previously staged ids.
 */
export async function submitNewSessionDraft(input: {
  readonly created: MobileSessionCreateResult | null;
  readonly attachments: readonly PromptAttachmentDraft[];
  readonly createSession: () => Promise<MobileSessionCreateResult>;
  readonly uploadAttachment: (item: PromptAttachmentDraft, sessionId: string) => Promise<PromptAttachmentDraft>;
  readonly prompt: (sessionId: string, attachmentIds: readonly string[]) => Promise<void>;
  readonly onCreated?: (created: MobileSessionCreateResult) => void;
  readonly onAttachments?: (attachments: readonly PromptAttachmentDraft[]) => void;
}): Promise<{
  readonly created: MobileSessionCreateResult;
  readonly attachments: readonly PromptAttachmentDraft[];
  readonly sent: boolean;
}> {
  const created = input.created ?? await input.createSession();
  input.onCreated?.(created);
  const staged = await uploadPendingAttachments(
    input.attachments,
    (item) => input.uploadAttachment(item, created.sessionId),
  );
  input.onAttachments?.(staged);
  if (!readyToSend(staged)) return { created, attachments: staged, sent: false };

  await input.prompt(created.sessionId, attachmentIds(staged));
  return { created, attachments: staged, sent: true };
}
