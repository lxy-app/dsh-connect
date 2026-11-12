import assert from 'node:assert/strict';
import test from 'node:test';
import type { HostAttachmentsService, WorkspaceFilesService } from '../src/host-api.js';
import type { StoredMessageDeclaration } from '../src/lib/attachment-index.js';
import { hostAttachmentByteReader, hostMessageAttachmentReader } from '../src/lib/runtime.js';

function request(signal: AbortSignal) {
  return {
    sessionId: 'sess-1',
    workspaceRoot: '/work/a',
    path: '/work/a/diagram.png',
    maxBytes: 20 << 20,
    signal,
  };
}

test('Host attachment reads use the complete-file contract instead of an oversized window', async () => {
  const signal = new AbortController().signal;
  const bytes = new Uint8Array([1, 2, 3]);
  let receivedOptions: unknown;
  let receivedScope: unknown;
  let receivedPath = '';
  let receivedSignal: AbortSignal | undefined;
  const workspaceFiles: WorkspaceFilesService = {
    async readBytes(scope, path, options, readSignal) {
      receivedScope = scope;
      receivedPath = path;
      receivedOptions = options;
      receivedSignal = readSignal;
      return { data: bytes, offset: 0, eof: true, bytes: bytes.byteLength };
    },
    async stat() { throw new Error('not used'); },
  };

  const result = await hostAttachmentByteReader(workspaceFiles)(request(signal));

  assert.equal(result, bytes);
  assert.deepEqual(receivedOptions, {});
  assert.deepEqual(receivedScope, { sessionId: 'sess-1', workspaceRoot: '/work/a' });
  assert.equal(receivedPath, '/work/a/diagram.png');
  assert.equal(receivedSignal, signal);
});

test('Host message attachment reads preserve image refs and assemble file streams', async () => {
  const signal = new AbortController().signal;
  const image: StoredMessageDeclaration = {
    attachmentId: 'att_image', sessionId: 'sess-1', workspaceId: 'ws-a', source: 'message', seq: 7,
    name: '拍摄.png', kind: 'image', mime: 'image/png', bytes: 3,
    reference: { attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png', bytes: 3, width: 10, height: 10 },
  };
  const file: StoredMessageDeclaration = {
    attachmentId: 'att_file', sessionId: 'sess-1', workspaceId: 'ws-a', source: 'message', seq: 7,
    name: 'notes.bin', kind: 'file', mime: 'application/octet-stream', bytes: 4,
    reference: { attachmentId: `sha256:${'b'.repeat(64)}`, name: 'notes.bin', bytes: 4 },
  };
  const attachments: HostAttachmentsService = {
    async readImage(ref, readSignal) {
      assert.equal(ref, image.reference);
      assert.equal(readSignal, signal);
      return { data: new Uint8Array([1, 2, 3]) };
    },
    async *readFileStream(ref, readSignal) {
      assert.equal(ref, file.reference);
      assert.equal(readSignal, signal);
      yield new Uint8Array([4, 5]);
      yield new Uint8Array([6, 7]);
    },
  };
  const read = hostMessageAttachmentReader(attachments);

  assert.deepEqual(await read({ sessionId: 'sess-1', declaration: image, maxBytes: 10, signal }), new Uint8Array([1, 2, 3]));
  assert.deepEqual(await read({ sessionId: 'sess-1', declaration: file, maxBytes: 4, signal }), new Uint8Array([4, 5, 6, 7]));
  await assert.rejects(
    read({ sessionId: 'sess-1', declaration: file, maxBytes: 3, signal }),
    { code: 'attachment_too_large' },
  );
});

test('Host complete-file size errors keep the attachment_too_large verdict', async () => {
  const workspaceFiles: WorkspaceFilesService = {
    async readBytes() {
      throw Object.assign(new Error('too large'), { code: 'workspace-file/too-large' });
    },
    async stat() { throw new Error('not used'); },
  };

  await assert.rejects(
    hostAttachmentByteReader(workspaceFiles)(request(new AbortController().signal)),
    { code: 'attachment_too_large' },
  );
});
