import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLocalMarkdownImagePath,
  markdownImageDestinations,
  rewriteAttachmentLinks,
} from '../src/lib/attachment-markdown.js';

test('rewrites an exact declared Markdown image path without changing its label', () => {
  const result = rewriteAttachmentLinks(
    '已生成：\n\n![架构图](/work/a/diagram.png)',
    [{ attachmentId: 'att_diagram', path: '/work/a/diagram.png' }],
  );
  assert.equal(result, '已生成：\n\n![架构图](dsh-attachment://att_diagram)');
});

test('supports angle-bracket image destinations with spaces', () => {
  const result = rewriteAttachmentLinks(
    '![小猫 图片](</work/a/generated cat.jpeg>)',
    [{ attachmentId: 'att_cat', path: '/work/a/generated cat.jpeg' }],
  );
  assert.equal(result, '![小猫 图片](<dsh-attachment://att_cat>)');
});

test('rewrites an exact declared ordinary file link without changing its label', () => {
  const result = rewriteAttachmentLinks(
    '已生成并交付测试文件：\n\n[DSH_Connect_移动端_Office_预览测试.docx](/work/a/DSH_Connect_移动端_Office_预览测试.docx)',
    [{ attachmentId: 'att_docx', path: '/work/a/DSH_Connect_移动端_Office_预览测试.docx' }],
  );
  assert.equal(result, '已生成并交付测试文件：\n\n[DSH_Connect_移动端_Office_预览测试.docx](dsh-attachment://att_docx)');
});

test('rewrites ordinary file links with angle-bracket destinations and spaces', () => {
  const result = rewriteAttachmentLinks(
    '[报告 最终版.docx](</work/a/报告 最终版.docx>)',
    [{ attachmentId: 'att_report', path: '/work/a/报告 最终版.docx' }],
  );
  assert.equal(result, '[报告 最终版.docx](<dsh-attachment://att_report>)');
});

test('rewrites both images and ordinary links in the same message', () => {
  const result = rewriteAttachmentLinks(
    '![截图](/work/a/shot.png)\n\n[说明文档](/work/a/readme.md)',
    [
      { attachmentId: 'att_shot', path: '/work/a/shot.png' },
      { attachmentId: 'att_readme', path: '/work/a/readme.md' },
    ],
  );
  assert.equal(result, '![截图](dsh-attachment://att_shot)\n\n[说明文档](dsh-attachment://att_readme)');
});

test('does not rewrite filename matches, ambiguous duplicates, or unrelated links', () => {
  const candidates = [
    { attachmentId: 'att_first', path: '/work/a/diagram.png' },
    { attachmentId: 'att_second', path: '/work/a/diagram.png' },
  ];
  const input = [
    '[普通链接](/work/a/diagram.png)',
    '![仅同名](diagram.png)',
    '![重复声明](/work/a/diagram.png)',
    '![其他文件](/work/a/other.png)',
    '[网页](https://example.com)',
    '[邮件](mailto:a@b.com)',
  ].join('\n\n');
  assert.equal(rewriteAttachmentLinks(input, candidates), input);
});

test('does not rewrite links inside inline code spans', () => {
  const result = rewriteAttachmentLinks(
    '`[示例](/work/a/diagram.png)`\n\n![真实](/work/a/diagram.png)',
    [{ attachmentId: 'att_diagram', path: '/work/a/diagram.png' }],
  );
  assert.equal(result, '`[示例](/work/a/diagram.png)`\n\n![真实](dsh-attachment://att_diagram)');
});

test('does not rewrite when there is no link destination', () => {
  const input = '普通文本，没有链接。';
  assert.equal(rewriteAttachmentLinks(input, [{ attachmentId: 'att_a', path: '/work/a/a.png' }]), input);
});

test('resolves relative destinations against the authorized workspace root', () => {
  const result = rewriteAttachmentLinks(
    '已更新：[wps-objectives-m1.html](prototypes/wps-objectives-m1.html)',
    [{ attachmentId: 'att_proto', path: '/work/a/prototypes/wps-objectives-m1.html' }],
    '/work/a',
  );
  assert.equal(result, '已更新：[wps-objectives-m1.html](dsh-attachment://att_proto)');
});

test('resolves ./ prefixed relative destinations', () => {
  const result = rewriteAttachmentLinks(
    '[说明](./docs/readme.md)',
    [{ attachmentId: 'att_readme', path: '/work/a/docs/readme.md' }],
    '/work/a',
  );
  assert.equal(result, '[说明](dsh-attachment://att_readme)');
});

test('does not escape the workspace or match by filename', () => {
  const candidates = [{ attachmentId: 'att_secret', path: '/work/secret.txt' }];
  const input = '[越界](../secret.txt)\n\n[同名](secret.txt)';
  assert.equal(rewriteAttachmentLinks(input, candidates, '/work/a'), input);
});

test('keeps URLs and anchors untouched even with a workspace root', () => {
  const input = '[网页](https://example.com/a) [锚点](#section)';
  assert.equal(rewriteAttachmentLinks(input, [], '/work/a'), input);
});

test('extracts local Markdown images but not ordinary links, code or external images', () => {
  const input = [
    '![首屏](prototypes/desktop.png)',
    '![移动端](<prototypes/mobile shot.webp>)',
    '[普通文件](prototypes/not-image.png)',
    '`![代码](prototypes/code.png)`',
    '![外部](https://example.com/remote.png)',
  ].join('\n\n');
  assert.deepEqual(markdownImageDestinations(input), [
    'prototypes/desktop.png',
    'prototypes/mobile shot.webp',
    'https://example.com/remote.png',
  ]);
  assert.equal(isLocalMarkdownImagePath('prototypes/desktop.png'), true);
  assert.equal(isLocalMarkdownImagePath('prototypes/mobile shot.webp'), true);
  assert.equal(isLocalMarkdownImagePath('https://example.com/remote.png'), false);
  assert.equal(isLocalMarkdownImagePath('prototypes/readme.md'), false);
});
