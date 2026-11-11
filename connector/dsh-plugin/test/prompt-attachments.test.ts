import assert from 'node:assert/strict';
import test from 'node:test';
import { PromptAttachmentAdmitter } from '../src/lib/prompt-attachments.js';
import type { PromptRequestInput } from '../src/lib/input-validation.js';

function prompt(overrides: Partial<PromptRequestInput> = {}): PromptRequestInput {
  return {
    requestId: 'req-1',
    sessionId: 'session-1',
    mode: 'queue',
    content: [
      { type: 'text', text: 'look at these' },
      { type: 'image', attachmentId: 'atu_image', name: '拍照 01.png', mime: 'image/png' },
      { type: 'file', attachmentId: 'atu_file', name: 'notes.txt', mime: 'text/plain; charset=utf-8' },
    ],
    attachments: [
      { type: 'image', attachmentId: 'atu_image', name: '拍照 01.png', mime: 'image/png' },
      { type: 'file', attachmentId: 'atu_file', name: 'notes.txt', mime: 'text/plain; charset=utf-8' },
    ],
    ...overrides,
  };
}

test('attachments become staged receipts in prompt order', async () => {
  const staged: string[] = [];
  const admitter = new PromptAttachmentAdmitter({
    uploads: {
      async uploadImageStream({ sessionId, name, mediaType }) {
        assert.equal(sessionId, 'session-1');
        assert.equal(mediaType, 'image/png');
        staged.push(`image:${name ?? ''}`);
        return { receiptId: 'receipt_image' };
      },
      async uploadStream({ sessionId, name }) {
        assert.equal(sessionId, 'session-1');
        staged.push(`file:${name ?? ''}`);
        return { receiptId: 'receipt_file' };
      },
    },
    download: async ({ attachmentId }) => new TextEncoder().encode(attachmentId),
  });
  const admission = await admitter.admit(prompt(), new AbortController().signal);
  assert.deepEqual(admission.admittedIds, ['atu_image', 'atu_file']);
  assert.deepEqual(admission.content, [
    { type: 'text', text: 'look at these' },
    { type: 'file', receiptId: 'receipt_image' },
    { type: 'file', receiptId: 'receipt_file' },
  ]);
  assert.deepEqual(staged, ['image:拍照 01.png', 'file:notes.txt']);
});

test('text-only prompts never touch the Host upload service', async () => {
  const admitter = new PromptAttachmentAdmitter({
    uploads: undefined,
    download: async () => {
      throw new Error('must not download');
    },
  });
  const admission = await admitter.admit(prompt({ content: [{ type: 'text', text: 'hi' }], attachments: undefined }), new AbortController().signal);
  assert.deepEqual(admission.content, [{ type: 'text', text: 'hi' }]);
  assert.deepEqual(admission.admittedIds, []);
});

test('a Host without file uploads refuses attachment prompts', async () => {
  const admitter = new PromptAttachmentAdmitter({ uploads: undefined, download: async () => new Uint8Array([1]) });
  assert.equal(admitter.available, false);
  await assert.rejects(
    admitter.admit(prompt(), new AbortController().signal),
    { code: 'unsupported_method' },
  );
});

test('an empty download or a refused receipt fails closed', async () => {
  const empty = new PromptAttachmentAdmitter({
    uploads: { async uploadStream() { return { receiptId: 'receipt' }; } },
    download: async () => new Uint8Array(),
  });
  await assert.rejects(empty.admit(prompt(), new AbortController().signal), { code: 'invalid_request' });

  const refused = new PromptAttachmentAdmitter({
    uploads: { async uploadStream() { return { receiptId: '' }; } },
    download: async () => new Uint8Array([1, 2, 3]),
  });
  await assert.rejects(refused.admit(prompt(), new AbortController().signal), { code: 'attachment_denied' });
});

test('a Host staging failure is reported as a denied attachment', async () => {
  const admitter = new PromptAttachmentAdmitter({
    uploads: { async uploadStream() { throw new Error('too large'); } },
    download: async () => new Uint8Array([1, 2, 3]),
  });
  await assert.rejects(admitter.admit(prompt(), new AbortController().signal), { code: 'attachment_denied' });
});
