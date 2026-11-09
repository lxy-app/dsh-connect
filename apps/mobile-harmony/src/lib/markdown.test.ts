import assert from 'node:assert/strict';
import test from 'node:test';

import { markdownToPlainText, parseInline } from './markdown';

test('Markdown images remain image nodes with their destination and alt text', () => {
  assert.deepEqual(parseInline('![小猫图片](dsh-attachment://att_b7Qk2m9xT4pL0rVc8sN1)'), [{
    type: 'image',
    href: 'dsh-attachment://att_b7Qk2m9xT4pL0rVc8sN1',
    alt: '小猫图片',
  }]);
});

test('ordinary Markdown links keep their existing node shape', () => {
  assert.deepEqual(parseInline('[项目](https://example.com)'), [{
    type: 'link',
    href: 'https://example.com',
    children: [{ type: 'text', text: '项目' }],
  }]);
});

test('image alt text remains readable in collapsed text and TTS projections', () => {
  assert.equal(
    markdownToPlainText('已生成：\n\n![小猫图片](dsh-attachment://att_b7Qk2m9xT4pL0rVc8sN1)'),
    '已生成：\n\n🖼 小猫图片',
  );
});
