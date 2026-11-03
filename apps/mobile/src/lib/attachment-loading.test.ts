import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ATTACHMENT_AUTO_RETRY_LIMIT,
  attachmentImageSource,
  shouldAutoRetryAttachment,
} from './attachment-loading';
import type { MobileAttachment } from '@/types/mobile';

const attachment: MobileAttachment = {
  attachmentId: 'att_b7Qk2m9xT4pL0rVc8sN1',
  kind: 'image',
  name: 'cat.jpg',
  mime: 'image/jpeg',
  bytes: 184320,
  source: 'deliverable',
  state: 'ready',
  sha256: '9f2c0123456789abcdef',
};

test('attachment image source keeps bearer auth in headers and versions ready bytes', () => {
  assert.deepEqual(attachmentImageSource(attachment, {
    serverUrl: 'https://connect.example.com/',
    accessToken: 'mobile-token',
  }), {
    uri: 'https://connect.example.com/v1/mobile/attachments/att_b7Qk2m9xT4pL0rVc8sN1?v=9f2c0123',
    headers: { Authorization: 'Bearer mobile-token' },
    cacheKey: '9f2c0123456789abcdef',
  });
});

test('attachment image source retries pending bytes under a distinct ready cache key', () => {
  const pending = { ...attachment, state: 'fetching', sha256: undefined };
  assert.deepEqual(attachmentImageSource(pending, {
    serverUrl: 'https://connect.example.com',
    accessToken: 'mobile-token',
  }), {
    uri: 'https://connect.example.com/v1/mobile/attachments/att_b7Qk2m9xT4pL0rVc8sN1',
    headers: { Authorization: 'Bearer mobile-token' },
    cacheKey: 'att_b7Qk2m9xT4pL0rVc8sN1',
  });
  const retry = attachmentImageSource(pending, {
    serverUrl: 'https://connect.example.com',
    accessToken: 'mobile-token',
  }, 1);
  assert.equal(
    retry.uri,
    'https://connect.example.com/v1/mobile/attachments/att_b7Qk2m9xT4pL0rVc8sN1?retry=1',
  );
  assert.equal(retry.cacheKey, 'att_b7Qk2m9xT4pL0rVc8sN1');
});

test('only pending attachment image failures retry automatically', () => {
  assert.equal(shouldAutoRetryAttachment('known', '202 response', 0), true);
  assert.equal(shouldAutoRetryAttachment('fetching', '202 response', 0), true);
  assert.equal(shouldAutoRetryAttachment('ready', 'network failed', 0), false);
  assert.equal(shouldAutoRetryAttachment('failed', 'desktop failed', 0), false);
  assert.equal(shouldAutoRetryAttachment('fetching', null, 0), false);
  assert.equal(
    shouldAutoRetryAttachment('fetching', 'still pending', ATTACHMENT_AUTO_RETRY_LIMIT),
    false,
  );
});
