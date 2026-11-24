import assert from 'node:assert/strict';
import test from 'node:test';

import { appendNewSessionTranscript, newSessionTitle, submitNewSessionDraft } from '@shared/lib/new-session-submit';
import { createAttachmentDraft, type PromptAttachmentDraft } from '@shared/lib/prompt-attachments';
import type { MobileSessionCreateResult } from '@shared/types/mobile';

const created: MobileSessionCreateResult = { sessionId: 'ses_new', workspaceId: 'ws_app' };

function image(name = 'screen.png'): PromptAttachmentDraft {
  return createAttachmentDraft({ kind: 'image', name, bytes: 128, uri: `file:///${name}` });
}

test('new session sends a text-only first prompt after one create', async () => {
  let creates = 0;
  let prompts = 0;
  const result = await submitNewSessionDraft({
    created: null,
    attachments: [],
    createSession: async () => { creates += 1; return created; },
    uploadAttachment: async (item) => item,
    prompt: async (sessionId, ids) => {
      prompts += 1;
      assert.equal(sessionId, created.sessionId);
      assert.deepEqual(ids, []);
    },
  });

  assert.equal(creates, 1);
  assert.equal(prompts, 1);
  assert.equal(result.sent, true);
});

test('new session uploads in order and prompts with the fresh attachment ids', async () => {
  const drafts = [image('one.png'), image('two.png')];
  const uploads: string[] = [];
  const result = await submitNewSessionDraft({
    created: null,
    attachments: drafts,
    createSession: async () => created,
    uploadAttachment: async (item, sessionId) => {
      assert.equal(sessionId, created.sessionId);
      uploads.push(item.name);
      return { ...item, state: 'ready', attachmentId: `atu_${item.name}` };
    },
    prompt: async (_sessionId, ids) => assert.deepEqual(ids, ['atu_one.png', 'atu_two.png']),
  });

  assert.deepEqual(uploads, ['one.png', 'two.png']);
  assert.equal(result.sent, true);
  assert.equal(drafts[0]?.state, 'local', 'the React input snapshot is not mutated');
  assert.equal(drafts[0]?.attachmentId, undefined);
});

test('an attachment failure blocks prompt and retry reuses the created session', async () => {
  const first = image('ready.png');
  const second = image('retry.png');
  let creates = 0;
  let prompts = 0;
  let retryUploads = 0;
  const uploadAttachment = async (item: PromptAttachmentDraft) => {
    if (item.name === 'retry.png' && retryUploads === 0) {
      retryUploads += 1;
      return { ...item, state: 'failed' as const, error: 'offline' };
    }
    return { ...item, state: 'ready' as const, attachmentId: `atu_${item.name}` };
  };
  const base = {
    attachments: [first, second],
    createSession: async () => { creates += 1; return created; },
    uploadAttachment,
    prompt: async () => { prompts += 1; },
  };

  const failed = await submitNewSessionDraft({ ...base, created: null });
  assert.equal(failed.sent, false);
  assert.equal(prompts, 0);
  assert.equal(failed.attachments[0]?.state, 'ready');
  assert.equal(failed.attachments[1]?.state, 'failed');

  const retried = await submitNewSessionDraft({ ...base, created: failed.created, attachments: failed.attachments });
  assert.equal(retried.sent, true);
  assert.equal(creates, 1, 'the retry does not create another session');
  assert.equal(retryUploads, 1, 'only the failed item needed a second upload');
  assert.equal(prompts, 1);
});

test('a prompt retry skips already staged uploads', async () => {
  let uploads = 0;
  let prompts = 0;
  const ready = { ...image(), state: 'ready' as const, attachmentId: 'atu_ready' };
  const input = {
    created,
    attachments: [ready],
    createSession: async () => { throw new Error('create must not run'); },
    uploadAttachment: async (item: PromptAttachmentDraft) => { uploads += 1; return item; },
    prompt: async () => { prompts += 1; throw new Error('prompt failed'); },
  };

  await assert.rejects(submitNewSessionDraft(input), /prompt failed/);
  await assert.rejects(submitNewSessionDraft(input), /prompt failed/);
  assert.equal(uploads, 0);
  assert.equal(prompts, 2);
});

test('new session applies the draft model before attachments and the first prompt', async () => {
  const calls: string[] = [];
  const result = await submitNewSessionDraft({
    created: null,
    attachments: [image()],
    createSession: async () => { calls.push('create'); return created; },
    selectModel: async (sessionId) => {
      assert.equal(sessionId, created.sessionId);
      calls.push('model');
    },
    uploadAttachment: async (item) => {
      calls.push('upload');
      return { ...item, state: 'ready', attachmentId: 'atu_ready' };
    },
    prompt: async () => { calls.push('prompt'); },
  });

  assert.deepEqual(calls, ['create', 'model', 'upload', 'prompt']);
  assert.equal(result.modelSelected, true);
});

test('an unconfirmed model selection blocks attachments and prompt across retries', async () => {
  let createdAttempt: MobileSessionCreateResult | null = null;
  let creates = 0;
  let selections = 0;
  let uploads = 0;
  let prompts = 0;
  const input = {
    attachments: [image()],
    createSession: async () => { creates += 1; return created; },
    selectModel: async () => { selections += 1; throw new Error('model timeout'); },
    uploadAttachment: async (item: PromptAttachmentDraft) => { uploads += 1; return item; },
    prompt: async () => { prompts += 1; },
    onCreated: (value: MobileSessionCreateResult) => { createdAttempt = value; },
  };

  await assert.rejects(submitNewSessionDraft({ ...input, created: createdAttempt, modelSelected: false }), /model timeout/);
  await assert.rejects(submitNewSessionDraft({ ...input, created: createdAttempt, modelSelected: false }), /model timeout/);
  assert.equal(creates, 1);
  assert.equal(selections, 2);
  assert.equal(uploads, 0);
  assert.equal(prompts, 0);
});

test('a prompt retry does not repeat a confirmed model selection', async () => {
  let createdAttempt: MobileSessionCreateResult | null = null;
  let modelSelected = false;
  let creates = 0;
  let selections = 0;
  let prompts = 0;
  const input = {
    attachments: [],
    createSession: async () => { creates += 1; return created; },
    selectModel: async () => { selections += 1; },
    uploadAttachment: async (item: PromptAttachmentDraft) => item,
    prompt: async () => {
      prompts += 1;
      if (prompts === 1) throw new Error('prompt failed');
    },
    onCreated: (value: MobileSessionCreateResult) => { createdAttempt = value; },
    onModelSelected: () => { modelSelected = true; },
  };

  await assert.rejects(submitNewSessionDraft({ ...input, created: createdAttempt, modelSelected }), /prompt failed/);
  const result = await submitNewSessionDraft({ ...input, created: createdAttempt, modelSelected });
  assert.equal(result.sent, true);
  assert.equal(creates, 1);
  assert.equal(selections, 1);
  assert.equal(prompts, 2);
});

test('voice transcription only edits the bounded new-session draft', () => {
  assert.equal(appendNewSessionTranscript('', '  第一条指令。 '), '第一条指令。');
  assert.equal(appendNewSessionTranscript('已有文字', '语音补充'), '已有文字\n语音补充');
  assert.equal(appendNewSessionTranscript('已有文字', '   '), '已有文字');
  assert.equal(appendNewSessionTranscript('1234', '56789', 6), '1234\n5');
});

test('attachment-only sessions receive a useful title', () => {
  assert.equal(newSessionTitle('', [image('架构图.png')]), '架构图.png');
  assert.equal(newSessionTitle('', [image('one.png'), image('two.png')]), '2 个附件的任务');
  assert.equal(newSessionTitle('  核对\n首条指令  ', []), '核对 首条指令');
});
