import type { MobileAttachment, MobileMessage } from '../types/mobile';

/**
 * One DSH turn as the chat should render it: the user's prompt, the folded
 * process (tool steps and intermediate narration) and the visible reply.
 */
export type TurnProcessGroup = {
  /** Stable identity from the first member's persistent event sequence. */
  key: string;
  steps: MobileMessage[];
};

export type TurnPart =
  | { kind: 'process'; key: string; process: TurnProcessGroup }
  | { kind: 'response'; key: string; message: MobileMessage };

export type TurnGroup = {
  key: string;
  turn?: number;
  user?: MobileMessage;
  /** Tool calls and assistant narration, in event order. */
  steps: MobileMessage[];
  /** Ordered process groups and visible replies; the final reply renders separately. */
  parts: TurnPart[];
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

export function runningTurnIndex(turns: readonly TurnGroup[], active: boolean): number {
  // A trailing user-only group is the new prompt's reply slot. Do not skip back
  // to an older group with content and mark its completed reply as running again.
  return active ? turns.length - 1 : -1;
}

/** Messages within five minutes share one centered time divider. */
export const TIME_DIVIDER_GAP_MS = 5 * 60 * 1_000;

/**
 * Decides whether a turn needs the WorkBuddy-style centered timestamp above it.
 * The gap is measured from the previous turn's last event so a long reply does
 * not force a divider before the very next prompt.
 */
export function shouldShowTimeDivider(
  previous: Pick<TurnGroup, 'endedAt'> | undefined,
  current: Pick<TurnGroup, 'startedAt'>,
  gapMs = TIME_DIVIDER_GAP_MS,
): boolean {
  if (current.startedAt <= 0) return false;
  if (!previous || previous.endedAt <= 0) return true;
  return current.startedAt - previous.endedAt >= gapMs;
}

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
  const lastVisible = [...entries].reverse().find(
    (message) => message.role === 'tool'
      || message.text.trim().length > 0
      || (message.attachments?.length ?? 0) > 0,
  );
  // Only a trailing visible assistant message is the final reply. If a tool
  // result follows it, this is an in-flight intermediate response and must
  // still split the two process groups instead of being moved to the end.
  const final = lastVisible?.role === 'assistant' ? lastVisible : undefined;
  const steps = entries.filter(
    (message) => message !== final && (message.role === 'tool' || message.text.trim().length > 0),
  );
  const parts = turnParts(entries, final);

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
    parts,
    ...(final ? { final } : {}),
    attachments,
    startedAt,
    endedAt,
  };
}

/**
 * Approximates DSH's visible process groups without projecting hidden Host nodes.
 * A visible assistant reply closes the preceding group; tool names and step
 * ordinals never decide grouping by themselves.
 */
function turnParts(entries: readonly MobileMessage[], final: MobileMessage | undefined): TurnPart[] {
  const parts: TurnPart[] = [];
  let members: MobileMessage[] = [];

  const flush = () => {
    const first = members[0];
    if (!first) return;
    const process: TurnProcessGroup = { key: `process-${first.seq}`, steps: members };
    parts.push({ kind: 'process', key: process.key, process });
    members = [];
  };

  for (const message of entries) {
    if (message === final) continue;
    const visible = message.role === 'tool'
      || message.text.trim().length > 0
      || (message.attachments?.length ?? 0) > 0;
    if (!visible) continue;
    if (message.role === 'assistant') {
      flush();
      parts.push({ kind: 'response', key: `response-${message.seq}`, message });
      continue;
    }
    members.push(message);
  }
  flush();
  return parts;
}

/** Human label shared by both runtime shells; it does not affect group boundaries. */
export function toolStepLabel(toolName?: string): string {
  const name = (toolName ?? '').toLowerCase();
  if (/bash|shell|exec|command|terminal|run/.test(name)) return '运行命令';
  if (/read|view|open|cat|list/.test(name)) return '读取';
  if (/write|edit|create|patch|apply/.test(name)) return '写入';
  if (/grep|search|glob|find|query/.test(name)) return '检索';
  if (/fetch|http|browse|web/.test(name)) return '访问';
  if (/task|agent|subagent/.test(name)) return '调用';
  return toolName || '步骤';
}

export function processGroupTitle(group: Pick<TurnProcessGroup, 'steps'>): string {
  const labels = [...new Set(group.steps.map((step) => toolStepLabel(step.toolName)))];
  return labels.length === 1 && labels[0] ? labels[0] : '执行过程';
}

/** Only the latest running group opens by default; an explicit choice always wins. */
export function processGroupOpen(
  manual: boolean | undefined,
  running: boolean,
  latest: boolean,
): boolean {
  return manual ?? (running && latest);
}
