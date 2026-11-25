'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { patchNetworkingBase64 } = require('./patch-networking-base64');

const upstream = `class NetworkingTurboModule {
  private base64Helper: util.Base64Helper = new util.Base64Helper();
  private encodeBody(data: Object): ArrayBuffer | undefined {
    if ('base64' in data) {
      const base64 = data.base64 as string;
      const textEncoder = new util.TextEncoder();
      const byteArray = textEncoder.encodeInto(base64);
      return byteArray.buffer;
    }
    return undefined;
  }
}`;

test('RNOH HTTP binary bodies decode base64 instead of sending its ASCII characters', () => {
  const result = patchNetworkingBase64(upstream);
  assert.equal(result.changed, true);
  assert.match(result.source, /this\.base64Helper\.decodeSync\(base64\)\.buffer/);
  assert.doesNotMatch(result.source, /textEncoder\.encodeInto\(base64\)/);
  const second = patchNetworkingBase64(result.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, result.source);
});

test('changed upstream networking code fails closed', () => {
  assert.throws(() => patchNetworkingBase64(upstream.replace('textEncoder.encodeInto(base64)', 'otherConversion(base64)')),
    /Unexpected RNOH NetworkingTurboModule/);
  assert.throws(() => patchNetworkingBase64(upstream.replace('private base64Helper: util.Base64Helper', 'private base64Helper: Unknown')),
    /Unexpected RNOH NetworkingTurboModule/);
});
