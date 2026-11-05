import assert from 'node:assert/strict';
import test from 'node:test';

import { rewriteAttachmentImageLinks } from '../src/lib/attachment-markdown.js';

test('rewrites an exact declared Markdown image path without changing its label', () => {
  const result = rewriteAttachmentImageLinks(
    '已生成：\n\n![架构图](/work/a/diagram.png)',
    [{ attachmentId: 'att_diagram', path: '/work/a/diagram.png' }],
  );
  assert.equal(result, '已生成：\n\n![架构图](dsh-attachment://att_diagram)');
});

test('supports angle-bracket image destinations with spaces', () => {
  const result = rewriteAttachmentImageLinks(
    '![小猫 图片](</work/a/generated cat.jpeg>)',
    [{ attachmentId: 'att_cat', path: '/work/a/generated cat.jpeg' }],
  );
  assert.equal(result, '![小猫 图片](<dsh-attachment://att_cat>)');
});

test('does not rewrite ordinary links, filename matches, or ambiguous duplicate declarations', () => {
  const candidates = [
    { attachmentId: 'att_first', path: '/work/a/diagram.png' },
    { attachmentId: 'att_second', path: '/work/a/diagram.png' },
  ];
  const input = [
    '[普通链接](/work/a/diagram.png)',
    '![仅同名](diagram.png)',
    '![重复声明](/work/a/diagram.png)',
    '![其他文件](/work/a/other.png)',
  ].join('\n\n');
  assert.equal(rewriteAttachmentImageLinks(input, candidates), input);
});
