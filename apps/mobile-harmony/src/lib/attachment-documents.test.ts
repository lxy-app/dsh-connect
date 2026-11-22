import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ATTACHMENT_DOCUMENT_PENDING_MAX_ATTEMPTS,
  ATTACHMENT_DOCUMENT_PENDING_TIMEOUT_MS,
  attachmentDocumentCacheKey,
  attachmentDocumentKind,
  attachmentDocumentRetryDelayMs,
  buildAttachmentDocumentUrl,
  canServeCachedAttachmentDocument,
  hasExpectedOriginalByteLength,
  hasPdfMagic,
  isAttachmentDocumentWithinLimit,
  isHtmlAttachment,
  isOfficePdfPreview,
  normalizeAttachmentDocumentETag,
  parseAttachmentDocumentPending,
  ATTACHMENT_DOCUMENT_TEXT_MAX_BYTES,
  ATTACHMENT_DOCUMENT_PDF_MAX_BYTES,
} from './attachment-documents';

const ATTACHMENT_ID = 'att_b7Qk2m9xT4pL0rVc8sN1';

test('declared text and office formats select the intended local preview', () => {
  assert.equal(attachmentDocumentKind({ name: 'README.MD', mime: 'application/octet-stream' }), 'markdown');
  assert.equal(attachmentDocumentKind({ name: 'notes.txt', mime: 'application/octet-stream' }), 'text');
  assert.equal(attachmentDocumentKind({ name: 'data.json', mime: 'application/octet-stream' }), 'text');
  assert.equal(attachmentDocumentKind({ name: 'runtime.log', mime: 'application/octet-stream' }), 'text');
  assert.equal(attachmentDocumentKind({ name: 'report.pdf', mime: 'application/octet-stream' }), 'pdf');
  for (const extension of ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']) {
    assert.equal(attachmentDocumentKind({ name: `report.${extension}`, mime: '' }), 'pdf');
  }
  assert.equal(attachmentDocumentKind({ name: 'archive.zip', mime: 'application/zip' }), null);
  assert.equal(attachmentDocumentKind({ name: 'photo.png', mime: 'image/png' }), null);
  assert.equal(attachmentDocumentKind({ name: 'no-extension', mime: 'application/pdf' }), 'pdf');
});

test('explicit MIME wins over misleading extensions except plain-text Markdown refinement', () => {
  assert.equal(attachmentDocumentKind({ name: 'misleading.pdf', mime: 'text/plain' }), 'text');
  assert.equal(attachmentDocumentKind({ name: 'misleading.md', mime: 'application/pdf' }), 'pdf');
  assert.equal(attachmentDocumentKind({ name: 'misleading.pdf', mime: 'application/zip' }), null);
  assert.equal(attachmentDocumentKind({ name: 'plain.md', mime: 'text/plain; charset=utf-8' }), 'markdown');
  assert.equal(attachmentDocumentKind({ name: 'payload', mime: 'application/x-json' }), 'text');
  assert.equal(attachmentDocumentKind({ name: 'runtime', mime: 'text/log' }), 'text');
});

test('HTML extensions and MIME use source-text preview while archives stay unsupported', () => {
  for (const attachment of [
    { name: 'page.html', mime: 'application/octet-stream' },
    { name: 'page.HTM', mime: '' },
    { name: 'page.html', mime: 'text/plain' },
    { name: 'payload', mime: 'text/html; charset=utf-8' },
  ]) {
    assert.equal(attachmentDocumentKind(attachment), 'text');
    assert.equal(isHtmlAttachment(attachment), true);
  }
  assert.equal(isHtmlAttachment({ name: 'README.md', mime: 'text/markdown' }), false);
  assert.equal(isHtmlAttachment({ name: 'misleading.html', mime: 'application/zip' }), false);
  assert.equal(attachmentDocumentKind({ name: 'misleading.html', mime: 'application/zip' }), null);
  assert.equal(attachmentDocumentKind({ name: 'archive.zip', mime: 'application/zip' }), null);
  assert.equal(isAttachmentDocumentWithinLimit(ATTACHMENT_DOCUMENT_TEXT_MAX_BYTES, 'text'), true);
  assert.equal(isAttachmentDocumentWithinLimit(ATTACHMENT_DOCUMENT_TEXT_MAX_BYTES + 1, 'text'), false);
});

test('only Office inputs are labelled as converted PDF previews', () => {
  assert.equal(isOfficePdfPreview({ name: 'report.pdf', mime: 'application/pdf' }), false);
  assert.equal(isOfficePdfPreview({ name: 'report.pdf', mime: 'application/octet-stream' }), false);
  assert.equal(isOfficePdfPreview({ name: 'no-extension', mime: 'application/pdf' }), false);
  assert.equal(isOfficePdfPreview({ name: 'report.docx', mime: 'application/octet-stream' }), true);
  assert.equal(isOfficePdfPreview({
    name: 'no-extension',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }), true);
});

test('document URLs use only encoded opaque ids and the preview endpoint for PDF', () => {
  assert.equal(
    buildAttachmentDocumentUrl('https://connect.example.com/', ATTACHMENT_ID, 'text'),
    `https://connect.example.com/v1/mobile/attachments/${ATTACHMENT_ID}`,
  );
  assert.equal(
    buildAttachmentDocumentUrl('https://connect.example.com/base/', ATTACHMENT_ID, 'pdf'),
    `https://connect.example.com/base/v1/mobile/attachments/${ATTACHMENT_ID}/preview`,
  );
  assert.throws(() => buildAttachmentDocumentUrl('https://connect.example.com', '../../etc/passwd', 'text'));
  assert.throws(() => buildAttachmentDocumentUrl('https://connect.example.com', 'https://evil.example', 'pdf'));
});

test('cache keys are bounded, safe and stable when a declaration gains sha256', () => {
  const attachment = {
    attachmentId: ATTACHMENT_ID,
    bytes: 123,
    sha256: '9f2c0123456789abcdef',
  };
  const key = attachmentDocumentCacheKey(attachment, 'https://connect.example.com/', 'text');
  assert.match(key, /^v1-[a-f0-9]{16}-att_[A-Za-z0-9_-]+-text$/);
  assert.ok(key.length < 180);
  assert.equal(key.includes('token'), false);
  assert.equal(key.includes('connect.example.com'), false);
  assert.equal(key.includes('/'), false);
  assert.equal(
    key,
    attachmentDocumentCacheKey(attachment, 'https://connect.example.com', 'text'),
  );
  assert.notEqual(
    key,
    attachmentDocumentCacheKey(attachment, 'https://other.example.com', 'text'),
  );
  assert.equal(
    key,
    attachmentDocumentCacheKey({ ...attachment, sha256: '0123456789abcdef00' }, 'https://connect.example.com', 'text'),
  );
  assert.equal(
    key,
    attachmentDocumentCacheKey({ attachmentId: ATTACHMENT_ID }, 'https://connect.example.com', 'text'),
  );
  assert.notEqual(
    key,
    attachmentDocumentCacheKey(attachment, 'https://connect.example.com', 'pdf'),
  );
  assert.match(
    attachmentDocumentCacheKey({ attachmentId: ATTACHMENT_ID, bytes: 123 }, 'https://connect.example.com', 'text'),
    /-text$/,
  );
  assert.throws(() => attachmentDocumentCacheKey({
    attachmentId: '../secret',
    bytes: 123,
  }, 'https://connect.example.com', 'text'));
});

test('202 parsing accepts only fetching or converting and applies bounded retry delays', () => {
  assert.deepEqual(parseAttachmentDocumentPending('{"state":"fetching","retryAfterMs":800}'), {
    state: 'fetching',
    retryAfterMs: 800,
  });
  assert.deepEqual(parseAttachmentDocumentPending('{"state":"converting"}'), { state: 'converting' });
  assert.equal(parseAttachmentDocumentPending('{"state":"ready"}'), null);
  assert.equal(parseAttachmentDocumentPending('not json'), null);
  assert.equal(attachmentDocumentRetryDelayMs({ state: 'fetching', retryAfterMs: 800 }, 0, 0), null);
  assert.equal(attachmentDocumentRetryDelayMs({ state: 'fetching', retryAfterMs: 800 }, 1, 0), 800);
  assert.equal(attachmentDocumentRetryDelayMs({ state: 'converting', retryAfterMs: 60_000 }, 1, 0), 5_000);
  assert.equal(attachmentDocumentRetryDelayMs({ state: 'fetching', retryAfterMs: 0 }, 1, 0), 250);
  assert.equal(attachmentDocumentRetryDelayMs({ state: 'converting' }, 91, 90_000), 1_000);
  assert.equal(attachmentDocumentRetryDelayMs({ state: 'fetching' }, 120, 119_500), 500);
  assert.equal(
    attachmentDocumentRetryDelayMs({ state: 'fetching' }, ATTACHMENT_DOCUMENT_PENDING_MAX_ATTEMPTS - 1, 0),
    1_000,
  );
  assert.equal(
    attachmentDocumentRetryDelayMs({ state: 'fetching' }, ATTACHMENT_DOCUMENT_PENDING_MAX_ATTEMPTS, 0),
    null,
  );
  assert.equal(
    attachmentDocumentRetryDelayMs({ state: 'fetching' }, 1, ATTACHMENT_DOCUMENT_PENDING_TIMEOUT_MS),
    null,
  );
});

test('original bytes and PDF signatures are validated independently', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\ncontent');
  assert.equal(hasPdfMagic(pdf), true);
  assert.equal(hasPdfMagic(new TextEncoder().encode('%PDX-1.7')), false);
  assert.equal(hasPdfMagic(new TextEncoder().encode('%PDF')), false);
  assert.equal(hasExpectedOriginalByteLength(pdf, pdf.byteLength), true);
  assert.equal(hasExpectedOriginalByteLength(pdf, pdf.byteLength - 1), false);
  assert.equal(hasExpectedOriginalByteLength(new Uint8Array(), 0), true);
  assert.equal(hasExpectedOriginalByteLength(pdf, -1), false);
});

test('text and PDF preview sizes have explicit upper bounds', () => {
  assert.equal(isAttachmentDocumentWithinLimit(ATTACHMENT_DOCUMENT_TEXT_MAX_BYTES, 'markdown'), true);
  assert.equal(isAttachmentDocumentWithinLimit(ATTACHMENT_DOCUMENT_TEXT_MAX_BYTES + 1, 'text'), false);
  assert.equal(isAttachmentDocumentWithinLimit(ATTACHMENT_DOCUMENT_PDF_MAX_BYTES, 'pdf'), true);
  assert.equal(isAttachmentDocumentWithinLimit(ATTACHMENT_DOCUMENT_PDF_MAX_BYTES + 1, 'pdf'), false);
  assert.equal(isAttachmentDocumentWithinLimit(-1, 'text'), false);
});

test('cache reuse requires an authorized 304 and never follows 401 or 403', () => {
  const etag = `"${'ab'.repeat(32)}"`;
  assert.equal(normalizeAttachmentDocumentETag(etag), etag);
  assert.equal(normalizeAttachmentDocumentETag(` ${etag} `), etag);
  assert.equal(normalizeAttachmentDocumentETag('invalid'), null);
  assert.equal(canServeCachedAttachmentDocument(304, true), true);
  assert.equal(canServeCachedAttachmentDocument(304, false), false);
  assert.equal(canServeCachedAttachmentDocument(200, true), false);
  assert.equal(canServeCachedAttachmentDocument(401, true), false);
  assert.equal(canServeCachedAttachmentDocument(403, true), false);
});
