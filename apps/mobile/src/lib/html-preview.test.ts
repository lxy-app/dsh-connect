import assert from 'node:assert/strict';
import test from 'node:test';

import { canNavigateLocalHtml, htmlReadAccessDirectory } from '@shared/lib/html-preview';

test('local HTML navigation allows documents and inline content only', () => {
  assert.equal(canNavigateLocalHtml('file:///cache/document.html'), true);
  assert.equal(canNavigateLocalHtml('data:text/html;base64,PGI+PC9iPg=='), true);
  assert.equal(canNavigateLocalHtml('blob:local-document'), true);
  assert.equal(canNavigateLocalHtml('about:blank'), true);
  assert.equal(canNavigateLocalHtml('https://example.com'), false);
  assert.equal(canNavigateLocalHtml('http://example.com'), false);
  assert.equal(canNavigateLocalHtml('mailto:a@example.com'), false);
});

test('read access is limited to the downloaded document directory', () => {
  assert.equal(
    htmlReadAccessDirectory('file:///cache/attachments/document.html'),
    'file:///cache/attachments/',
  );
  assert.equal(htmlReadAccessDirectory('document.html'), 'document.html');
});
