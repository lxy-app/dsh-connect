import type { TranscriptMessage } from './host-session-adapter.js';

export interface TranscriptBudgetResult {
  readonly messages: TranscriptMessage[];
  readonly droppedMessages: boolean;
  readonly truncated: boolean;
}

/**
 * Applies one budget across user-message and delivered attachments. The Server
 * adds a small response envelope, so the message array keeps 1 KiB of headroom
 * under the 64 KiB wire target.
 */
export function fitTranscriptBudget(
  input: readonly TranscriptMessage[],
  { maxAttachments = 12, maxBytes = 63 * 1024 } = {},
): TranscriptBudgetResult {
  const messages = input.map((message) => ({
    ...message,
    ...(message.attachments ? { attachments: [...message.attachments] } : {}),
  }));
  let truncated = false;
  let droppedMessages = false;

  let attachmentCount = countAttachments(messages);
  while (attachmentCount > maxAttachments) {
    const index = messages.findIndex((message) => (message.attachments?.length ?? 0) > 0);
    if (index < 0) break;
    const message = messages[index];
    if (!message) break;
    const attachments = [...(message.attachments ?? [])];
    attachments.shift();
    message.attachments = attachments;
    attachmentCount -= 1;
    truncated = true;
    if (!message.text && attachments.length === 0) {
      messages.splice(index, 1);
      droppedMessages = true;
    }
  }

  while (byteLength(messages) > maxBytes && messages.length > 0) {
    if (messages.length > 1) {
      messages.shift();
      droppedMessages = true;
      truncated = true;
      continue;
    }
    const message = messages[0];
    if (!message) break;
    const attachments = [...(message.attachments ?? [])];
    if (attachments.length > 0) {
      attachments.pop();
      message.attachments = attachments;
      truncated = true;
      if (!message.text && attachments.length === 0) {
        messages.pop();
        droppedMessages = true;
      }
      continue;
    }
    const original = message.text;
    if (original.length === 0) break;
    const characters = Array.from(original);
    let low = 0;
    let high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      message.text = characters.slice(0, middle).join('');
      if (byteLength(messages) <= maxBytes) low = middle;
      else high = middle - 1;
    }
    message.text = characters.slice(0, low).join('');
    truncated = true;
    break;
  }

  return { messages, droppedMessages, truncated };
}

function countAttachments(messages: readonly TranscriptMessage[]): number {
  return messages.reduce((total, message) => total + (message.attachments?.length ?? 0), 0);
}

function byteLength(messages: readonly TranscriptMessage[]): number {
  return Buffer.byteLength(JSON.stringify(messages));
}
