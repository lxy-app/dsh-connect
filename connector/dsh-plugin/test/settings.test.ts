import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDeviceName, normalizeServerUrl, normalizeSettings } from '../src/lib/settings.js';

test('normalizes user-owned Server settings on the Host', () => {
  assert.equal(normalizeServerUrl(' HTTP://127.0.0.1:8787/ '), 'http://127.0.0.1:8787');
  assert.equal(normalizeServerUrl('https://Example.COM:443'), 'https://example.com');
  assert.deepEqual(normalizeSettings({ serverUrl: 'wss://example.com/', deviceName: '  My Mac  ' }), {
    serverUrl: 'wss://example.com', deviceName: 'My Mac',
  });
  assert.equal(normalizeDeviceName('Desktop'), 'Desktop');
});

test('rejects ambiguous or unsafe Server settings without connecting', () => {
  for (const value of ['', 'not a url', 'ftp://example.com', 'https://user:secret@example.com', 'https://example.com/base', 'https://example.com/?x=1', 'https://example.com/#fragment']) {
    assert.throws(() => normalizeServerUrl(value), (error: unknown) => {
      return (error as { code?: unknown }).code === 'invalid_server_url';
    });
  }
  assert.throws(() => normalizeDeviceName('  '), (error: unknown) => (error as { code?: unknown }).code === 'invalid_device_name');
  assert.throws(() => normalizeDeviceName('x'.repeat(257)), (error: unknown) => (error as { code?: unknown }).code === 'invalid_device_name');
});
