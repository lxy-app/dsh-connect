import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachmentFileStem,
  attachmentMimeType,
  attachmentNameFromSafUri,
  attachmentUti,
  nextAvailableAttachmentFileName,
  normalizeAttachmentSaveName,
  savedFileHasExpectedBytes,
} from './attachment-save-utils';

test('save names stay local and numeric suffixes avoid case-insensitive collisions', () => {
  assert.equal(normalizeAttachmentSaveName('../../report.pdf'), '.._.._report.pdf');
  assert.equal(normalizeAttachmentSaveName('..'), 'attachment');
  assert.equal(normalizeAttachmentSaveName('  '), 'attachment');
  assert.equal(nextAvailableAttachmentFileName('report.pdf', new Set()), 'report.pdf');
  assert.equal(
    nextAvailableAttachmentFileName('report.pdf', new Set(['REPORT.PDF', 'report (1).pdf'])),
    'report (2).pdf',
  );
  assert.equal(
    nextAvailableAttachmentFileName('README', new Set(['readme', 'README (1)'])),
    'README (2)',
  );
  assert.equal(attachmentFileStem('report (2).PDF'), 'report (2)');
  assert.equal(attachmentFileStem('.env'), '.env');
});

test('SAF display names are decoded when the provider exposes them in document ids', () => {
  assert.equal(
    attachmentNameFromSafUri('content://com.android.externalstorage.documents/tree/primary%3ADownload/document/primary%3ADownload%2Freport%20(1).pdf'),
    'report (1).pdf',
  );
  assert.equal(
    attachmentNameFromSafUri('content://com.android.externalstorage.documents/tree/primary%3ADownload/document/primary%3ADownload%2FREADME'),
    'README',
  );
  assert.equal(attachmentNameFromSafUri('content://opaque.provider/document/123'), null);
  assert.equal(attachmentNameFromSafUri('%invalid'), null);
});

test('Android MIME and iOS UTI preserve common original formats including HTML', () => {
  assert.equal(attachmentMimeType({ name: 'page.html', mime: 'text/html; charset=utf-8' }), 'text/html');
  assert.equal(attachmentMimeType({ name: 'page.htm', mime: '' }), 'text/html');
  assert.equal(attachmentMimeType({ name: 'archive.zip', mime: 'application/octet-stream' }), 'application/zip');
  assert.equal(
    attachmentMimeType({ name: 'report.docx', mime: 'application/octet-stream' }),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.equal(attachmentUti({ name: 'page.htm', mime: 'text/html' }), 'public.html');
  assert.equal(attachmentUti({ name: 'notes.md', mime: 'text/plain' }), 'net.daringfireball.markdown');
  assert.equal(attachmentUti({ name: 'legacy.doc', mime: 'application/msword' }), 'com.microsoft.word.doc');
  assert.equal(attachmentUti({ name: 'archive.zip', mime: 'application/zip' }), 'public.zip-archive');
});

test('Android save succeeds only for an existing non-directory with every source byte', () => {
  assert.equal(savedFileHasExpectedBytes({ exists: true, isDirectory: false, size: 123 }, 123), true);
  assert.equal(savedFileHasExpectedBytes({ exists: true, isDirectory: false, size: 122 }, 123), false);
  assert.equal(savedFileHasExpectedBytes({ exists: false, isDirectory: false }, 123), false);
  assert.equal(savedFileHasExpectedBytes({ exists: true, isDirectory: true, size: 123 }, 123), false);
  assert.equal(savedFileHasExpectedBytes({ exists: true, isDirectory: false, size: 0 }, 0), true);
});
