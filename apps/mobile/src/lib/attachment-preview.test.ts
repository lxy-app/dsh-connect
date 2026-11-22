import assert from 'node:assert/strict';
import test from 'node:test';

import type { MobileAttachment } from '@shared/types/mobile';
import { buildAttachmentPreviewUrl } from './mobile-api';
import {
  ATTACHMENT_PENDING_MAX_ATTEMPTS,
  ATTACHMENT_PENDING_TIMEOUT_MS,
  attachmentCacheFileName,
  attachmentPreviewFailure,
  attachmentPreviewKind,
  attachmentPreviewSpec,
  canOpenAttachment,
  canServeCachedAttachment,
  hasPdfMagic,
  isHtmlAttachment,
  nextPendingRetryMs,
  normalizeAttachmentETag,
  parsePendingRetryMs,
  pendingAttachmentState,
  validateAttachmentPreviewBytes,
} from './attachment-preview';

const SHA = '0123456789abcdef'.repeat(4);

function document(overrides: Partial<MobileAttachment> = {}): MobileAttachment {
  return {
    attachmentId: 'att_b7Qk2m9xT4pL0rVc8sN1',
    kind: 'file',
    name: 'notes.md',
    mime: 'text/markdown',
    bytes: 12,
    source: 'deliverable',
    state: 'ready',
    sha256: SHA,
    ...overrides,
  };
}

test('MIME identifies document strategy and extensions only assist generic or plain metadata', () => {
  assert.equal(attachmentPreviewKind(document()), 'markdown');
  assert.equal(attachmentPreviewKind(document({ mime: 'text/plain' })), 'markdown');
  assert.equal(attachmentPreviewKind(document({ name: 'data.json', mime: 'application/json; charset=utf-8' })), 'text');
  assert.equal(attachmentPreviewKind(document({ name: 'run.log', mime: 'text/plain' })), 'text');
  assert.equal(attachmentPreviewKind(document({ name: 'report.pdf', mime: 'application/pdf' })), 'pdf');
  assert.equal(attachmentPreviewKind(document({
    name: 'deck.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })), 'office');
  assert.equal(attachmentPreviewKind(document({ name: 'report.pdf', mime: 'application/octet-stream' })), 'pdf');
  assert.equal(attachmentPreviewKind(document({ name: 'sheet.xlsx', mime: '' })), 'office');
  assert.equal(attachmentPreviewKind(document({ name: 'report.pdf', mime: 'text/plain' })), 'text');
  assert.equal(attachmentPreviewKind(document({ name: 'archive.zip', mime: 'application/zip' })), 'unsupported');
  assert.equal(attachmentPreviewKind(document({ name: 'index.html', mime: 'text/html; charset=utf-8' })), 'text');
  assert.equal(attachmentPreviewKind(document({ name: 'index.htm', mime: 'application/octet-stream' })), 'text');
  assert.equal(attachmentPreviewKind(document({ name: 'index.HTML', mime: '' })), 'text');
  assert.equal(attachmentPreviewKind(document({ name: 'page.html', mime: 'application/json' })), 'text');
  assert.equal(isHtmlAttachment(document({ name: 'page.html', mime: 'application/json' })), false);
  assert.equal(isHtmlAttachment(document({ name: 'page.txt', mime: 'text/html' })), true);
  assert.equal(isHtmlAttachment(document({ name: 'page.htm', mime: 'application/octet-stream' })), true);
  assert.equal(isHtmlAttachment(document({ name: 'notes.md', mime: 'text/markdown' })), false);
  assert.equal(attachmentPreviewKind(document({ kind: 'image', name: 'x.pdf', mime: 'image/png' })), 'image');
  assert.equal(canOpenAttachment(document({ kind: 'image', mime: 'image/png', state: 'unavailable' })), true);
  assert.equal(canOpenAttachment(document({ state: 'unavailable' })), false);
  assert.equal(canOpenAttachment(document({ name: 'archive.zip', mime: 'application/zip' })), true);
});

test('preview URL is authorized separately and never contains a token or desktop path', () => {
  assert.equal(
    buildAttachmentPreviewUrl('https://connect.example.com/base/', 'att_b7Qk2m9xT4pL0rVc8sN1'),
    'https://connect.example.com/base/v1/mobile/attachments/att_b7Qk2m9xT4pL0rVc8sN1/preview',
  );
  assert.equal(
    buildAttachmentPreviewUrl('https://connect.example.com', 'att_a/b'),
    'https://connect.example.com/v1/mobile/attachments/att_a%2Fb/preview',
  );
});

test('document cache filenames separate servers and keep immutable ids across sha arrival', () => {
  const ready = document();
  const known = document({ sha256: undefined, state: 'known' });
  const key = attachmentCacheFileName(ready, 'https://connect.example.com/');
  assert.match(key, /^server-[0-9a-f]{16}-id-att_b7Qk2m9xT4pL0rVc8sN1\.source-v1\.md$/);
  assert.equal(key, attachmentCacheFileName(ready, 'https://connect.example.com'));
  assert.equal(key, attachmentCacheFileName(known, 'https://connect.example.com'));
  assert.notEqual(key, attachmentCacheFileName(ready, 'https://other.example.com'));
  const officeKey = attachmentCacheFileName(document({
    name: 'deck.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    sha256: undefined,
  }), 'https://connect.example.com');
  assert.match(officeKey, /^server-[0-9a-f]{16}-id-att_b7Qk2m9xT4pL0rVc8sN1\.preview-v1\.pdf$/);
  assert.throws(() => attachmentCacheFileName(document({ attachmentId: '../../private', sha256: undefined }), 'https://connect.example.com'));
  assert.throws(() => attachmentCacheFileName(document({ sha256: '../../private', attachmentId: 'bad id' }), 'https://connect.example.com'));
  assert.equal(attachmentPreviewSpec(document({ name: 'archive.zip', mime: 'application/zip' })), null);
});

test('fresh original bytes and generated PDFs are validated before publication', () => {
  const md = document({ bytes: 2 });
  const mdSpec = attachmentPreviewSpec(md);
  assert.ok(mdSpec);
  assert.equal(validateAttachmentPreviewBytes(new TextEncoder().encode('ok'), md, mdSpec), null);
  assert.equal(
    validateAttachmentPreviewBytes(new TextEncoder().encode('bad'), md, mdSpec)?.code,
    'invalid_attachment_bytes',
  );
  assert.equal(
    validateAttachmentPreviewBytes(new Uint8Array(2 * 1024 * 1024 + 1), md, mdSpec)?.code,
    'payload_too_large',
  );

  const office = document({
    name: 'report.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const pdfSpec = attachmentPreviewSpec(office);
  assert.ok(pdfSpec);
  const pdf = new TextEncoder().encode('%PDF-1.7\n');
  assert.equal(hasPdfMagic(pdf), true);
  assert.equal(validateAttachmentPreviewBytes(pdf, office, pdfSpec), null);
  assert.equal(validateAttachmentPreviewBytes(new TextEncoder().encode('{"error":{}}'), office, pdfSpec)?.code, 'invalid_pdf');
  assert.equal(
    validateAttachmentPreviewBytes(new Uint8Array(50 * 1024 * 1024 + 1), office, pdfSpec)?.code,
    'payload_too_large',
  );
});

test('HTML uses the bounded original-file preview strategy while ZIP remains save-only', () => {
  const script = new TextEncoder().encode('<script>alert(1)</script>');
  const html = document({ name: 'index.html', mime: 'text/html', bytes: script.byteLength });
  const spec = attachmentPreviewSpec(html);
  assert.ok(spec);
  assert.equal(spec.kind, 'text');
  assert.equal(spec.source, 'original');
  assert.equal(spec.maxBytes, 2 * 1024 * 1024);
  assert.equal(validateAttachmentPreviewBytes(script, html, spec), null);
  assert.equal(
    validateAttachmentPreviewBytes(new Uint8Array(2 * 1024 * 1024 + 1), html, spec)?.code,
    'payload_too_large',
  );
  assert.equal(attachmentPreviewSpec(document({ name: 'archive.zip', mime: 'application/zip' })), null);
});

test('202 retry honors server hints but remains bounded beyond a 90 second conversion', () => {
  assert.equal(pendingAttachmentState({ state: 'fetching' }), 'fetching');
  assert.equal(pendingAttachmentState({ state: 'converting' }), 'converting');
  assert.equal(pendingAttachmentState({ state: 'ready' }), null);
  assert.equal(parsePendingRetryMs('2', null), 2_000);
  assert.equal(parsePendingRetryMs(null, { retryAfterMs: 3_000 }), 3_000);
  assert.equal(parsePendingRetryMs('999', null), 5_000);
  assert.equal(parsePendingRetryMs(null, { retryAfterMs: 0 }), 250);
  assert.equal(nextPendingRetryMs({
    attempt: 1, elapsedMs: 90_000, retryAfterHeader: '2', payload: { state: 'converting' },
  }), 2_000);
  assert.equal(nextPendingRetryMs({
    attempt: 1, elapsedMs: ATTACHMENT_PENDING_TIMEOUT_MS - 100, retryAfterHeader: '2', payload: {},
  }), 100);
  assert.equal(nextPendingRetryMs({
    attempt: 1, elapsedMs: ATTACHMENT_PENDING_TIMEOUT_MS, retryAfterHeader: '1', payload: {},
  }), null);
  assert.equal(nextPendingRetryMs({
    attempt: ATTACHMENT_PENDING_MAX_ATTEMPTS, elapsedMs: 0, retryAfterHeader: '1', payload: {},
  }), null);
});

test('HTTP and conversion failures map to actionable, non-document responses', () => {
  assert.deepEqual(attachmentPreviewFailure(503, { error: { code: 'preview_unavailable' } }), {
    code: 'preview_unavailable',
    message: 'Server 尚未配置文档转换服务，请在桌面查看原文件。',
    retryable: false,
  });
  assert.equal(attachmentPreviewFailure(415, { error: { code: 'preview_unsupported' } }).code, 'preview_unsupported');
  assert.equal(attachmentPreviewFailure(409, { error: { code: 'preview_failed' } }).retryable, true);
  assert.equal(attachmentPreviewFailure(401, null).code, 'unauthorized');
  assert.equal(attachmentPreviewFailure(403, null).code, 'forbidden');
  assert.equal(attachmentPreviewFailure(409, { state: 'failed', errorCode: 'attachment_denied' }).code, 'attachment_denied');
  assert.equal(attachmentPreviewFailure(500, null).retryable, true);
});

test('cached documents require an authorized 304 and valid digest metadata', () => {
  const etag = `"${SHA}"`;
  assert.equal(normalizeAttachmentETag(etag), etag);
  assert.equal(normalizeAttachmentETag(` ${etag} `), etag);
  assert.equal(normalizeAttachmentETag('stale-etag'), null);
  assert.equal(normalizeAttachmentETag(null), null);
  assert.equal(canServeCachedAttachment(304, true), true);
  assert.equal(canServeCachedAttachment(304, false), false);
  assert.equal(canServeCachedAttachment(200, true), false);
  assert.equal(canServeCachedAttachment(401, true), false);
  assert.equal(canServeCachedAttachment(403, true), false);
});
