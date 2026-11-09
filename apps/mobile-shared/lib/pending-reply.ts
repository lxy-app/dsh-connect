export type PendingReplyProgress = {
  afterSeq: number;
  text: string;
  userObserved?: boolean;
};

export type PendingTranscriptProgress = {
  messages: readonly { role: string; text: string; seq: number }[];
  turnEndSeq?: number;
};

/** Aligns a sent prompt with durable transcript progress without confusing an
 * older turn/end with completion of the current prompt. */
export function resolvePendingReply<T extends PendingReplyProgress>(
  current: T,
  transcript: PendingTranscriptProgress,
): T | null {
  let sentSeq = current.afterSeq;
  const wasUserObserved = current.userObserved === true;
  let userObserved = wasUserObserved;
  for (const message of transcript.messages) {
    if (message.role !== 'user' || message.text !== current.text) continue;
    if (message.seq > current.afterSeq || userObserved) userObserved = true;
    sentSeq = Math.max(sentSeq, message.seq);
  }
  const replied = transcript.messages.some(
    (message) => message.role === 'assistant' && message.seq > sentSeq,
  );
  const turnEnded = (transcript.turnEndSeq ?? 0) > sentSeq
    && (current.text === '' || userObserved);
  if (replied || turnEnded) return null;
  if (sentSeq > current.afterSeq || userObserved !== wasUserObserved) {
    return { ...current, afterSeq: sentSeq, ...(userObserved ? { userObserved: true } : {}) };
  }
  return current;
}
