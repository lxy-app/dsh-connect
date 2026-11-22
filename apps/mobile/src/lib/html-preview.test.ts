import assert from 'node:assert/strict';
import test from 'node:test';

import { canNavigateLocalHtml } from '@shared/lib/html-preview';

test('local HTML navigation allows documents and inline content only', () => {
  assert.equal(canNavigateLocalHtml('file:///cache/document.html'), false);
  assert.equal(canNavigateLocalHtml('data:text/html;base64,PGI+PC9iPg=='), true);
  assert.equal(canNavigateLocalHtml('blob:local-document'), true);
  assert.equal(canNavigateLocalHtml('about:blank'), true);
  assert.equal(canNavigateLocalHtml('https://example.com'), false);
  assert.equal(canNavigateLocalHtml('http://example.com'), false);
  assert.equal(canNavigateLocalHtml('mailto:a@example.com'), false);
});
