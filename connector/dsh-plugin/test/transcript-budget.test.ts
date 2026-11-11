import assert from 'node:assert/strict';
import test from 'node:test';
import { fitTranscriptBudget } from '../src/lib/transcript-budget.js';
import type { TranscriptMessage } from '../src/lib/host-session-adapter.js';

function attachment(index: number, name = `file-${index}.txt`, source: 'message' | 'deliverable' | 'tool' = 'message') {
  return {
    attachmentId: `att_${String(index).padStart(8, '0')}`,
    kind: 'file' as const, name, mime: 'text/plain', bytes: 10, source, state: 'known' as const,
  };
}

function message(attachments: TranscriptMessage['attachments'], text = 'look'): TranscriptMessage {
  return { id: 'u-1', seq: 1, role: 'user', text, ...(attachments ? { attachments } : {}), occurredAt: '2026-11-11T00:00:00.000Z' };
}

test('one attachment count budget is shared by message, deliverable and tool sources', () => {
  const result = fitTranscriptBudget([message([
    ...Array.from({ length: 8 }, (_, index) => attachment(index)),
    attachment(8, 'present.png', 'deliverable'),
    attachment(9, 'returned.png', 'tool'),
    attachment(10, 'extra-1.txt'),
    attachment(11, 'extra-2.txt'),
    attachment(12, 'extra-3.txt'),
  ])]);

  assert.equal(result.messages[0]?.attachments?.length, 12);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.messages[0]?.attachments?.slice(-3).map((item) => item.name), ['extra-1.txt', 'extra-2.txt', 'extra-3.txt']);
});

test('long attachment names cannot exceed the transcript byte budget', () => {
  const result = fitTranscriptBudget([
    message(Array.from({ length: 12 }, (_, index) => attachment(index, `${'长'.repeat(2_000)}-${index}.txt`)), ''),
  ]);

  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result.messages)) <= 63 * 1024);
  assert.ok((result.messages[0]?.attachments?.length ?? 0) < 12);
});

test('a single multibyte text message is truncated without splitting UTF-8', () => {
  const result = fitTranscriptBudget([message([], '汉'.repeat(30_000))], { maxBytes: 4_096 });

  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result.messages)) <= 4_096);
  assert.ok((result.messages[0]?.text.length ?? 0) > 0);
  assert.match(result.messages[0]?.text ?? '', /^汉+$/);
});
