import assert from 'node:assert/strict';
import test from 'node:test';
import {
  admitAttachment,
  attachmentFailureSummary,
  attachmentIds,
  canSubmitPrompt,
  createAttachmentDraft,
  formatBytes,
  isImageMime,
  readyToSend,
  uploadPendingAttachments,
  MAX_PROMPT_ATTACHMENTS,
} from '@shared/lib/prompt-attachments';

test('a picked file becomes a draft with a normalized name and type', () => {
  const draft = createAttachmentDraft({
    kind: 'file',
    name: '../../etc/passwd',
    mime: undefined,
    bytes: 2048,
    uri: 'file:///cache/passwd',
  });
  assert.equal(draft.name, 'etcpasswd');
  assert.equal(draft.mime, 'application/octet-stream');
  assert.equal(draft.state, 'local');
  assert.equal(draft.bytes, 2048);
});

test('images infer their MIME type from the extension when the picker omits it', () => {
  assert.equal(createAttachmentDraft({ kind: 'image', name: 'a.PNG', uri: 'file:///a' }).mime, 'image/png');
  assert.equal(createAttachmentDraft({ kind: 'image', name: 'b.webp', uri: 'file:///b' }).mime, 'image/webp');
  assert.equal(createAttachmentDraft({ kind: 'image', name: 'c.gif', uri: 'file:///c' }).mime, 'image/gif');
  assert.equal(createAttachmentDraft({ kind: 'image', name: 'd.heic', uri: 'file:///d' }).mime, 'image/jpeg');
});

test('admission enforces the count, the size cap and duplicate picks', () => {
  const full = Array.from({ length: MAX_PROMPT_ATTACHMENTS }, (_, index) =>
    createAttachmentDraft({ kind: 'file', name: `f${index}.txt`, bytes: 10, uri: `file:///f${index}` }),
  );
  const extra = createAttachmentDraft({ kind: 'file', name: 'extra.txt', bytes: 10, uri: 'file:///extra' });
  assert.equal(admitAttachment(extra, full).ok, false);

  const tooBig = createAttachmentDraft({ kind: 'file', name: 'huge.zip', bytes: 21 * 1024 * 1024, uri: 'file:///huge' });
  const bigResult = admitAttachment(tooBig, []);
  assert.equal(bigResult.ok, false);
  if (!bigResult.ok) assert.match(bigResult.reason, /20\.0 MB/);

  const first = createAttachmentDraft({ kind: 'file', name: 'same.txt', bytes: 12, uri: 'file:///one' });
  const duplicate = createAttachmentDraft({ kind: 'file', name: 'same.txt', bytes: 12, uri: 'file:///two' });
  const duplicateResult = admitAttachment(duplicate, [first]);
  assert.equal(duplicateResult.ok, false);

  assert.equal(admitAttachment(extra, []).ok, true);
});

test('a prompt may be text only, attachment only, or both', () => {
  const draft = createAttachmentDraft({ kind: 'image', name: 'x.png', bytes: 10, uri: 'file:///x' });
  assert.equal(canSubmitPrompt('', []), false);
  assert.equal(canSubmitPrompt('   ', []), false);
  assert.equal(canSubmitPrompt('hi', []), true);
  assert.equal(canSubmitPrompt('', [draft]), true);
  assert.equal(canSubmitPrompt('hi', [draft]), true);
});

test('sending waits until every attachment is staged', () => {
  const local = createAttachmentDraft({ kind: 'file', name: 'a.txt', bytes: 1, uri: 'file:///a' });
  const ready = { ...local, localId: 'b', state: 'ready' as const, attachmentId: 'atu_1' };
  const failed = { ...local, localId: 'c', state: 'failed' as const };
  assert.equal(readyToSend([]), true);
  assert.equal(readyToSend([ready]), true);
  assert.equal(readyToSend([ready, local]), false);
  assert.equal(readyToSend([ready, failed]), false);
  assert.deepEqual(attachmentIds([ready, local, failed]), ['atu_1']);
});

test('send preparation returns the fresh ids produced by pending uploads', async () => {
  const camera = createAttachmentDraft({ kind: 'image', name: 'camera.jpg', bytes: 10, uri: 'file:///camera' });
  const document = createAttachmentDraft({ kind: 'file', name: 'notes.pdf', bytes: 20, uri: 'file:///notes' });
  const uploaded: string[] = [];

  const staged = await uploadPendingAttachments([camera, document], async (item) => {
    uploaded.push(item.localId);
    return { ...item, state: 'ready', attachmentId: `atu_${item.name}` };
  });

  assert.deepEqual(uploaded, [camera.localId, document.localId]);
  assert.equal(readyToSend(staged), true);
  assert.deepEqual(attachmentIds(staged), ['atu_camera.jpg', 'atu_notes.pdf']);
  assert.equal(attachmentIds([camera, document]).length, 0);
});

test('send preparation preserves a failed upload so the prompt stays blocked', async () => {
  const ready = { ...createAttachmentDraft({ kind: 'image', name: 'ready.png', bytes: 10, uri: 'file:///ready' }), state: 'ready' as const, attachmentId: 'atu_ready' };
  const failedDraft = createAttachmentDraft({ kind: 'file', name: 'failed.zip', bytes: 20, uri: 'file:///failed' });

  const staged = await uploadPendingAttachments([ready, failedDraft], async (item) => ({
    ...item,
    state: 'failed',
    error: 'network',
  }));

  assert.equal(readyToSend(staged), false);
  assert.deepEqual(attachmentIds(staged), ['atu_ready']);
  assert.equal(staged[1]?.error, 'network');
});

test('failure summaries and byte formatting stay user-facing', () => {
  const failed = { ...createAttachmentDraft({ kind: 'file', name: 'log.txt', bytes: 1, uri: 'file:///l' }), state: 'failed' as const };
  assert.equal(attachmentFailureSummary([]), null);
  assert.equal(attachmentFailureSummary([failed]), 'log.txt 上传失败，可单独重试');
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.50 MB');
  assert.equal(formatBytes(12 * 1024 * 1024), '12.0 MB');
});

test('only DSH-admissible image types count as images', () => {
  assert.equal(isImageMime('image/png'), true);
  assert.equal(isImageMime('image/jpeg'), true);
  assert.equal(isImageMime('image/heic'), false);
  assert.equal(isImageMime('application/pdf'), false);
});