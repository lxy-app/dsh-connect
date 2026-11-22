import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeAttachmentFileName } from './attachment-file-name';

test('picker filenames preserve normal attachment names and Unicode', () => {
  assert.equal(sanitizeAttachmentFileName('季度 报表.final.HTML'), '季度 报表.final.HTML');
  assert.equal(sanitizeAttachmentFileName('  report.pdf  '), 'report.pdf');
});

test('picker filenames never contain paths, NUL or control characters', () => {
  assert.equal(sanitizeAttachmentFileName('folder/report.pdf'), 'folderreport.pdf');
  assert.equal(sanitizeAttachmentFileName('folder\\report.pdf'), 'folderreport.pdf');
  assert.equal(sanitizeAttachmentFileName('re\u0000po\nrt\u009f.pdf'), 'report.pdf');
  assert.equal(sanitizeAttachmentFileName('../..\\secret'), '....secret');
});

test('empty and relative-only picker filenames use a safe fallback', () => {
  for (const name of ['', '   ', '\u0000\n\u009f', '.', '..']) {
    assert.equal(sanitizeAttachmentFileName(name), 'attachment');
  }
});
