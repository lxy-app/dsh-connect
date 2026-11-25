import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countActionableInteractions,
  feedbackForDecisionError,
  feedbackForMissing,
  feedbackRetentionUntil,
  interactionFeedbackText,
  remainingInteractionSeconds,
} from '@shared/lib/interaction-feedback';
import type { MobileInteraction } from '@shared/types/mobile';

const deadline = '2026-11-25T07:00:00.000Z';
const interaction = { interactionId: 'one', expiresAt: deadline } as MobileInteraction;
const at = (secondsBefore: number) => Date.parse(deadline) - secondsBefore * 1000;

test('countdown uses absolute server deadline including resume and last ten seconds', () => {
  assert.equal(remainingInteractionSeconds(deadline, at(45)), 45);
  assert.equal(remainingInteractionSeconds(deadline, at(10)), 10);
  assert.equal(remainingInteractionSeconds(deadline, at(0.2)), 1);
  assert.equal(remainingInteractionSeconds(deadline, at(0)), 0);
  assert.equal(remainingInteractionSeconds(deadline, at(-8)), 0);
  assert.equal(remainingInteractionSeconds('not-a-date', at(45)), 0);
});

test('actionable badge excludes expired and submitting items', () => {
  const second = { interactionId: 'two', expiresAt: deadline } as MobileInteraction;
  const expired = { interactionId: 'expired', expiresAt: '2026-11-25T06:59:00.000Z' } as MobileInteraction;
  assert.equal(countActionableInteractions([interaction, second, expired], at(5), null), 2);
  assert.equal(countActionableInteractions([interaction, second, expired], at(5), 'one'), 1);
  assert.equal(countActionableInteractions([interaction, second, expired], at(-1), null), 0);
  assert.equal(countActionableInteractions([interaction], 0, null), 0);
});

test('missing from pending list does not invent a withdrawal or other-end decision', () => {
  assert.equal(feedbackForMissing(interaction, at(20)), 'unknown');
  assert.equal(feedbackForMissing(interaction, at(-1)), 'expired');
  assert.match(interactionFeedbackText('unknown'), /桌面查看状态/);
});

test('indeterminate POST stays visible until the server deadline, never just six seconds', () => {
  assert.equal(feedbackRetentionUntil('unconfirmed', deadline, at(40)), at(-6));
  assert.equal(feedbackRetentionUntil('unconfirmed', deadline, at(-2)), at(-8));
  assert.equal(feedbackRetentionUntil('allowed', deadline, at(40)), at(34));
});

test('only explicit server result distinguishes decided and expired; uncertainty never implies success', () => {
  assert.equal(feedbackForDecisionError('interaction_decided', interaction, at(5)), 'decided');
  assert.equal(feedbackForDecisionError('interaction_expired', interaction, at(5)), 'expired');
  assert.equal(feedbackForDecisionError('interaction_not_found', interaction, at(5)), 'unknown');
  assert.equal(feedbackForDecisionError('network_error', interaction, at(5)), 'unconfirmed');
  assert.equal(feedbackForDecisionError('timeout', interaction, at(-5)), 'unconfirmed');
  assert.match(interactionFeedbackText('unconfirmed'), /不会自动重试/);
});
