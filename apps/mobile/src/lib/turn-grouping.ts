import type { MobileAttachment, MobileMessage } from '@/types/mobile';

/**
 * One DSH turn as the chat should render it: the user's prompt, the folded
 * process (tool steps and intermediate narration) and the visible reply.
 */
export type TurnGroup = {
  key: string;
  turn?: number;
  user?: MobileMessage;
  /** Tool calls and assistant narration, in event order. */
  steps: MobileMessage[];
  /** Last assistant message with visible content; kept outside the fold. */
  final?: MobileMessage;
  /** Every attachment declared inside the turn, de-duplicated. */
  attachments: MobileAttachment[];
  startedAt: number;
  endedAt: number;
};

type Draft = {
  key: string;
  turn?: number;
  user?: MobileMessage;
  entries: MobileMessage[];
};

/**
 * Groups a transcript into turns.
 *
 * DSH emits one `assistant/message` per text block inside a turn, so grouping by
 * message would split a single answer into several cards. Turns start at a
 * user message; a page that begins mid-turn still yields a usable anonymous
 * group. Messages must already be sorted by `seq`.
 */
export function groupTurns(messages: readonly MobileMessage[]): TurnGroup[] {
  const drafts: Draft[] = [];
  let current: Draft | undefined;

  for (const message of messages) {
    const turn = turnOf(message);
    if (message.role === 'user') {
      current = {
        key: turn !== undefined ? `turn-${turn}` : `user-${message.seq}`,
        ...(turn !== undefined ? { turn } : {}),
        user: message,
        entries: [],
      };
      drafts.push(current);
      continue;
    }
    if (message.role !== 'assistant' && message.role !== 'tool') continue;
    if (!current) {
      current = {
        key: turn !== undefined ? `turn-${turn}` : `seq-${message.seq}`,
        ...(turn !== undefined ? { turn } : {}),
        entries: [],
      };
      drafts.push(current);
    }
    current.entries.push(message);
    if (current.turn === undefined && turn !== undefined) current.turn = turn;
  }

  return drafts.map(finalize);
}

function turnOf(message: MobileMessage): number | undefined {
  return typeof message.turn === 'number' && Number.isSafeInteger(message.turn) && message.turn > 0
    ? message.turn
    : undefined;
}

function finalize(draft: Draft): TurnGroup {
  const entries = draft.entries;
  const final = [...entries].reverse().find(
    (message) => message.role === 'assistant'
      && (message.text.trim().length > 0 || (message.attachments?.length ?? 0) > 0),
  );
  const steps = entries.filter(
    (message) => message !== final && (message.role === 'tool' || message.text.trim().length > 0),
  );

  const attachments: MobileAttachment[] = [];
  const seen = new Set<string>();
  for (const message of entries) {
    for (const attachment of message.attachments ?? []) {
      if (seen.has(attachment.attachmentId)) continue;
      seen.add(attachment.attachmentId);
      attachments.push(attachment);
    }
  }

  const times = [draft.user, ...entries]
    .filter((message): message is MobileMessage => message !== undefined)
    .map((message) => Date.parse(message.occurredAt))
    .filter((time) => Number.isFinite(time));
  const startedAt = times.length > 0 ? Math.min(...times) : 0;
  const endedAt = times.length > 0 ? Math.max(...times) : 0;

  return {
    key: draft.key,
    ...(draft.turn !== undefined ? { turn: draft.turn } : {}),
    ...(draft.user ? { user: draft.user } : {}),
    steps,
    ...(final ? { final } : {}),
    attachments,
    startedAt,
    endedAt,
  };
}
