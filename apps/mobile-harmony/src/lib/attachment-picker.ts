import { createAttachmentDraft, type PromptAttachmentDraft } from '@shared/lib/prompt-attachments';

/** How the user asked for attachments: the composer "更多" sheet has one tile each. */
export type AttachmentSource = 'camera' | 'library' | 'document';

export type AttachmentPickResult =
  | { readonly kind: 'picked'; readonly drafts: readonly PromptAttachmentDraft[] }
  | { readonly kind: 'canceled' }
  | { readonly kind: 'denied'; readonly reason: string };

/**
 * Attachment picking for the Harmony shell.
 *
 * RNOH has no image-picker or document-picker JS API yet: the Harmony builds of
 * those Expo modules ship only the native module stub. Picking therefore fails
 * with an explicit reason instead of pretending to work; a Harmony-native
 * picker module is a separate piece of work. The draft bar, upload and prompt
 * paths are already shared with the main App, so only this file changes when
 * that module lands.
 */
export async function pickAttachments(
  source: AttachmentSource,
  _options: { readonly remainingSlots: number },
): Promise<AttachmentPickResult> {
  void source;
  void createAttachmentDraft;
  return {
    kind: 'denied',
    reason: '鸿蒙版暂不支持选择附件，请在 iOS 或 Android 上发送图片和文件。',
  };
}
