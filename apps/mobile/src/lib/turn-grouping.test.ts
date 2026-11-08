import assert from 'node:assert/strict';
import test from 'node:test';

import { groupTurns, runningTurnIndex } from './turn-grouping';
import type { MobileMessage } from '@/types/mobile';

function message(partial: Partial<MobileMessage> & Pick<MobileMessage, 'seq' | 'role'>): MobileMessage {
  return {
    id: `m-${partial.seq}`,
    text: '',
    occurredAt: new Date(1_700_000_000_000 + partial.seq * 1_000).toISOString(),
    ...partial,
  };
}

test('folds one turn into a single group and keeps the last reply outside the steps', () => {
  const turns = groupTurns([
    message({ seq: 1, role: 'user', text: '查一下', turn: 1 }),
    message({ seq: 2, role: 'assistant', text: '先看投影位置', turn: 1 }),
    message({ seq: 3, role: 'tool', text: '', toolName: 'bash', summary: 'rg -n assistant', status: 'ok', turn: 1 }),
    message({ seq: 4, role: 'assistant', text: '结论：没有被折叠', turn: 1 }),
  ]);

  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.turn, 1);
  assert.equal(turns[0]?.user?.text, '查一下');
  assert.equal(turns[0]?.final?.text, '结论：没有被折叠');
  assert.deepEqual(turns[0]?.steps.map((step) => step.role), ['assistant', 'tool']);
});

test('a new user message starts a new group', () => {
  const turns = groupTurns([
    message({ seq: 1, role: 'user', text: '第一轮' }),
    message({ seq: 2, role: 'assistant', text: '答复一' }),
    message({ seq: 3, role: 'user', text: '第二轮' }),
    message({ seq: 4, role: 'assistant', text: '答复二' }),
  ]);

  assert.equal(turns.length, 2);
  assert.equal(turns[1]?.user?.text, '第二轮');
  assert.equal(turns[1]?.final?.text, '答复二');
});

test('a new prompt owns the running state without reactivating the previous reply', () => {
  const turns = groupTurns([
    message({ seq: 1, role: 'user', text: '第一轮', turn: 1 }),
    message({ seq: 2, role: 'assistant', text: '已完成的第一轮答复', turn: 1 }),
    message({ seq: 3, role: 'user', text: '第二轮', turn: 2 }),
  ]);

  assert.equal(runningTurnIndex(turns, true), 1);
  assert.equal(turns[0]?.final?.text, '已完成的第一轮答复');
  assert.equal(turns[1]?.final, undefined);
  assert.equal(runningTurnIndex(turns, false), -1);
});

test('an active reply with content remains the running turn', () => {
  const turns = groupTurns([
    message({ seq: 1, role: 'user', text: '第一轮' }),
    message({ seq: 2, role: 'assistant', text: '正在回复' }),
  ]);

  assert.equal(runningTurnIndex(turns, true), 0);
  assert.equal(runningTurnIndex([], true), -1);
});

test('a page that starts mid-turn still produces a usable group', () => {
  const turns = groupTurns([
    message({ seq: 7, role: 'assistant', text: '中间过程' }),
    message({ seq: 8, role: 'assistant', text: '最终答复' }),
  ]);

  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.user, undefined);
  assert.equal(turns[0]?.steps.length, 1);
  assert.equal(turns[0]?.final?.text, '最终答复');
});

test('empty assistant fragments never become steps', () => {
  const turns = groupTurns([
    message({ seq: 1, role: 'user', text: '继续' }),
    message({ seq: 2, role: 'assistant', text: '   ' }),
    message({ seq: 3, role: 'assistant', text: '答复' }),
  ]);

  assert.equal(turns[0]?.steps.length, 0);
  assert.equal(turns[0]?.final?.text, '答复');
});

test('attachments from the whole turn are collected once', () => {
  const image = {
    attachmentId: 'att_1',
    kind: 'image' as const,
    name: 'a.png',
    mime: 'image/png',
    bytes: 12,
    source: 'deliverable',
    state: 'known',
  };
  const turns = groupTurns([
    message({ seq: 1, role: 'user', text: '出图' }),
    message({ seq: 2, role: 'assistant', text: '', delivery: true, attachments: [image] }),
    message({ seq: 3, role: 'assistant', text: '', attachments: [image] }),
  ]);

  assert.equal(turns[0]?.attachments.length, 1);
  assert.equal(turns[0]?.attachments[0]?.attachmentId, 'att_1');
  // The delivery message is the turn's visible content, so it stays outside the fold.
  assert.equal(turns[0]?.final?.seq, 3);
  assert.equal(turns[0]?.final?.text, '');
  assert.equal(turns[0]?.steps.length, 0);
});

test('duration derives from the turn messages', () => {
  const turns = groupTurns([
    message({ seq: 1, role: 'user', text: '开始' }),
    message({ seq: 2, role: 'assistant', text: '完成' }),
  ]);

  assert.equal(turns[0]?.endedAt - (turns[0]?.startedAt ?? 0), 1_000);
});
