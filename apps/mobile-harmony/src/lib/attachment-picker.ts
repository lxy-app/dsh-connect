import {
  HarmonyAttachmentPickerNative,
  type HarmonyAttachmentPickerSource,
} from '../../modules/harmony-attachment-picker';
import {
  describeAttachmentPickerError,
  harmonyPickerPayloadToAttachmentPickResult,
  type AttachmentPickResult,
} from '@/lib/attachment-picker-result';
import { discardPickedAttachmentPayload } from '@/lib/attachment-picker-cache';

/** How the user asked for attachments: the composer "更多" sheet has one tile each. */
export type AttachmentSource = HarmonyAttachmentPickerSource;
export type { AttachmentPickResult } from '@/lib/attachment-picker-result';

/**
 * Opens the Harmony system picker and maps its cached files onto draft attachments.
 * Native failures stay inside this boundary because both composer call sites intentionally
 * fire-and-forget; cancellation remains a no-op and all other failures use the existing alert.
 */
export async function pickAttachments(
  source: AttachmentSource,
  options: { readonly remainingSlots: number },
): Promise<AttachmentPickResult> {
  if (options.remainingSlots <= 0) {
    return { kind: 'denied', reason: '已达单条消息附件数量上限' };
  }
  let payload: string | undefined;
  try {
    payload = await HarmonyAttachmentPickerNative.pick(source, options.remainingSlots);
    return harmonyPickerPayloadToAttachmentPickResult(payload, options.remainingSlots);
  } catch (cause) {
    if (payload !== undefined) discardPickedAttachmentPayload(payload);
    return { kind: 'denied', reason: describeAttachmentPickerError(cause) };
  }
}
