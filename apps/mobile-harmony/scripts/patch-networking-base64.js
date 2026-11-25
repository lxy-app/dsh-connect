'use strict';

const fs = require('node:fs');

const ORIGINAL = `    if ('base64' in data) {
      const base64 = data.base64 as string;
      const textEncoder = new util.TextEncoder();
      const byteArray = textEncoder.encodeInto(base64);
      return byteArray.buffer;
    }`;
const PATCHED = `    if ('base64' in data) {
      const base64 = data.base64 as string;
      // React Native uses this field for binary request bodies, not literal base64 text.
      return this.base64Helper.decodeSync(base64).buffer;
    }`;

/** RNOH 0.84.1 otherwise posts a typed-array body as base64 ASCII instead of bytes. */
function patchNetworkingBase64(source) {
  if (source.includes(PATCHED)) return { source, changed: false };
  if (!source.includes(ORIGINAL) || !source.includes('private base64Helper: util.Base64Helper')) {
    throw new Error('Unexpected RNOH NetworkingTurboModule base64 implementation; review the patch.');
  }
  return { source: source.replace(ORIGINAL, PATCHED), changed: true };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node patch-networking-base64.js <NetworkingTurboModule.ts>');
  const result = patchNetworkingBase64(fs.readFileSync(file, 'utf8'));
  if (result.changed) {
    fs.writeFileSync(file, result.source);
    console.log(`[patch] ${file}: decode binary HTTP request bodies`);
  }
}

module.exports = { patchNetworkingBase64 };
