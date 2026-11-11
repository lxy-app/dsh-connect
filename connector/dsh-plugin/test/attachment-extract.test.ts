import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  attachmentID,
  extractAttachmentCandidates,
  extractMessageAttachmentCandidates,
  DEFAULT_TOOL_ALLOWLIST,
} from '../src/lib/attachment-extract.js';
import { evaluateAttachmentPath, isSensitivePath, ATTACHMENT_ERROR_DENIED } from '../src/lib/attachment-policy.js';

function record(type: string, seq: number, data: unknown) {
  return { event: { type, seq, time: 1_760_000_000_000, data } };
}

test('attachment ids are deterministic and carry no path', () => {
  const first = attachmentID('sess-1', 'deliverable', 12, 0);
  const again = attachmentID('sess-1', 'deliverable', 12, 0);
  const otherSession = attachmentID('sess-2', 'deliverable', 12, 0);
  assert.equal(first, again);
  assert.notEqual(first, otherSession);
  assert.match(first, /^att_[A-Za-z0-9_-]{24}$/);
  assert.ok(!first.includes('sess'));
});

test('present events become one declaration per file, in order', () => {
  const records = [
    record('turn/start', 1, {}),
    record('deliverables/presented', 2, {
      turn: 1,
      callId: 'call-1',
      files: [
        { path: '/work/a/architecture.png', description: '架构图' },
        { path: '/work/a/notes.md' },
      ],
    }),
    record('turn/end', 3, {}),
  ];
  const candidates = extractAttachmentCandidates(records, { sessionId: 'sess-1' });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.name, 'architecture.png');
  assert.equal(candidates[0]?.description, '架构图');
  assert.equal(candidates[0]?.source, 'deliverable');
  assert.equal(candidates[1]?.name, 'notes.md');
  assert.deepEqual(
    candidates.map((candidate) => candidate.attachmentId),
    [
      attachmentID('sess-1', 'deliverable', 2, 0),
      attachmentID('sess-1', 'deliverable', 2, 1),
    ],
  );
});

test('persisted user image and file blocks become opaque message declarations', () => {
  const imageRef = `sha256:${'a'.repeat(64)}`;
  const fileRef = `sha256:${'b'.repeat(64)}`;
  const candidates = extractMessageAttachmentCandidates({
    id: 'u-7', role: 'user', source: { kind: 'user' },
    content: [
      { type: 'text', text: '看图和文件' },
      { type: 'image', attachment: {
        attachmentId: imageRef, mediaType: 'image/png', bytes: 1234, width: 640, height: 480, name: '拍摄.png',
      } },
      { type: 'file', attachment: { attachmentId: fileRef, name: 'notes.pdf', bytes: 4567 } },
    ],
  }, { sessionId: 'sess-1', seq: 7 });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.source, 'message');
  assert.equal(candidates[0]?.name, '拍摄.png');
  assert.equal(candidates[0]?.mime, 'image/png');
  assert.equal(candidates[0]?.width, 640);
  assert.equal(candidates[0]?.reference.attachmentId, imageRef);
  assert.equal(candidates[1]?.mime, 'application/pdf');
  assert.equal(candidates[1]?.reference.attachmentId, fileRef);
  assert.deepEqual(candidates.map((candidate) => candidate.attachmentId), [
    attachmentID('sess-1', 'message', 7, 1),
    attachmentID('sess-1', 'message', 7, 2),
  ]);
  assert.equal(JSON.stringify(candidates.map(({ reference: _reference, ...candidate }) => candidate)).includes('sha256:'), false);
});

test('only allowlisted tools contribute, and only when the result succeeded', () => {
  const call = record('tool/call', 4, {
    callId: 'call-9',
    name: DEFAULT_TOOL_ALLOWLIST[0],
    arguments: { path: '/work/a/report.png' },
  });
  const ignoredCall = record('tool/call', 5, {
    callId: 'call-10',
    name: 'shell',
    arguments: { path: '/etc/passwd' },
  });
  const failed = extractAttachmentCandidates([
    call,
    record('tool/result', 6, { message: { toolCallId: 'call-9', isError: true } }),
  ], { sessionId: 'sess-1' });
  assert.equal(failed.length, 0);

  const succeeded = extractAttachmentCandidates([
    call,
    ignoredCall,
    record('tool/result', 6, { message: { toolCallId: 'call-9' } }),
    record('tool/result', 7, { message: { toolCallId: 'call-10' } }),
  ], { sessionId: 'sess-1' });
  assert.equal(succeeded.length, 1);
  assert.equal(succeeded[0]?.source, 'tool');
  assert.equal(succeeded[0]?.name, 'report.png');

  const disabled = extractAttachmentCandidates([
    call,
    record('tool/result', 6, { message: { toolCallId: 'call-9' } }),
  ], { sessionId: 'sess-1', toolAllowlist: [] });
  assert.equal(disabled.length, 0);
});

test('sensitive names are refused regardless of location', () => {
  assert.equal(isSensitivePath('/home/me/.ssh/id_rsa'), true);
  assert.equal(isSensitivePath('/work/.env'), true);
  assert.equal(isSensitivePath('/work/certs/server.pem'), true);
  assert.equal(isSensitivePath('/work/cookies'), true);
  assert.equal(isSensitivePath('/work/notes.md'), false);
});

test('workspace containment, symlinks and size limits are enforced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-attach-policy-'));
  const outside = await mkdtemp(join(tmpdir(), 'dsh-attach-outside-'));
  const inside = join(root, 'diagram.png');
  await writeFile(inside, 'png-bytes');
  const outsideFile = join(outside, 'secret.txt');
  await writeFile(outsideFile, 'secret');
  await symlink(inside, join(root, 'link.png'));

  const allowed = await evaluateAttachmentPath(inside, { workspaceRoot: root, maxBytes: 1024 });
  assert.equal(allowed.ok, true);

  const denied = await evaluateAttachmentPath(outsideFile, { workspaceRoot: root, maxBytes: 1024 });
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false ? denied.errorCode : '', ATTACHMENT_ERROR_DENIED);

  const permitted = await evaluateAttachmentPath(outsideFile, {
    workspaceRoot: root,
    maxBytes: 1024,
    allowOutsideWorkspace: true,
  });
  assert.equal(permitted.ok, true);

  const linked = await evaluateAttachmentPath(join(root, 'link.png'), { workspaceRoot: root, maxBytes: 1024 });
  assert.equal(linked.ok, false);

  const tooLarge = await evaluateAttachmentPath(inside, { workspaceRoot: root, maxBytes: 1 });
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.ok === false ? tooLarge.errorCode : '', 'attachment_too_large');

  const missing = await evaluateAttachmentPath(join(root, 'absent.png'), { workspaceRoot: root, maxBytes: 1024 });
  assert.equal(missing.ok, false);
});
