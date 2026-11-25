import type { MobileInteraction } from '../types/mobile';

export type InteractionFeedback = 'allowed' | 'rejected' | 'answered' | 'expired' | 'decided' | 'unknown' | 'unconfirmed';

/** The Server deadline is authoritative; never restart a window on app resume. */
export function remainingInteractionSeconds(expiresAt: string, now: number): number {
  const deadline = Date.parse(expiresAt);
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

export function interactionFeedbackText(feedback: InteractionFeedback): string {
  switch (feedback) {
    case 'allowed': return '已允许一次，桌面将继续执行';
    case 'rejected': return '已拒绝，本次操作不会执行';
    case 'answered': return '回答已提交，桌面将继续处理';
    case 'expired': return '手机处理时间已到，请在桌面继续处理';
    case 'decided': return '已在其他端处理';
    case 'unknown': return '请求已不再等待手机处理，请到桌面查看状态';
    case 'unconfirmed': return '结果待确认，请到桌面核对；不会自动重试';
  }
}

export function feedbackRetentionUntil(feedback: InteractionFeedback, expiresAt: string, now: number, durationMs = 6_000): number {
  const deadline = Date.parse(expiresAt);
  // A transport failure may follow a committed POST: keep its unknown state visible
  // until the original window closes, and never generate a new decision request.
  if (feedback === 'unconfirmed' && Number.isFinite(deadline)) {
    return Math.max(now, deadline) + durationMs;
  }
  return now + durationMs;
}

export function countActionableInteractions(interactions: readonly MobileInteraction[], now: number, busyId: string | null): number {
  if (now <= 0) return 0;
  return interactions.filter((item) => item.interactionId !== busyId && remainingInteractionSeconds(item.expiresAt, now) > 0).length;
}

/** A missing pending item is ambiguous: the list API does not expose withdrawal reasons. */
export function feedbackForMissing(interaction: MobileInteraction, now: number): InteractionFeedback {
  return remainingInteractionSeconds(interaction.expiresAt, now) === 0 ? 'expired' : 'unknown';
}

export function feedbackForDecisionError(code: string | undefined, interaction: MobileInteraction, now: number): InteractionFeedback {
  if (code === 'interaction_decided') return 'decided';
  if (code === 'interaction_expired') return 'expired';
  if (code === 'interaction_not_found') return feedbackForMissing(interaction, now);
  // Even an HTTP/transport error can follow a committed decision; never issue a fresh requestId.
  return 'unconfirmed';
}
