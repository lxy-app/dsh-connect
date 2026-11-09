import assert from 'node:assert/strict';
import test from 'node:test';

import { gzip, ungzip } from 'pako';

import {
  buildVolcAsrUrl,
  decodeVolcAsrFrame,
  encodeVolcAsrFrame,
  extractVolcAsrText,
} from './volc-asr';

test('ASR request frame uses protocol v1, JSON, gzip and positive sequence', () => {
  const frame = encodeVolcAsrFrame('{"hello":"world"}', 1, 'request');
  assert.deepEqual([...frame.subarray(0, 4)], [0x11, 0x11, 0x11, 0x00]);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  assert.equal(view.getInt32(4, false), 1);
  assert.equal(view.getUint32(8, false), frame.byteLength - 12);
  assert.equal(new TextDecoder().decode(frame.subarray(12)), new TextDecoder().decode(gzip('{"hello":"world"}')));
});

test('ASR audio frames preserve PCM and mark the last chunk with a negative sequence', () => {
  const pcm = new Uint8Array([0, 1, 2, 255]);
  const ordinary = encodeVolcAsrFrame(pcm, 2);
  const final = encodeVolcAsrFrame(pcm, -2);
  assert.equal(ordinary[1], 0x21);
  assert.equal(final[1], 0x23);
  assert.equal(new DataView(final.buffer).getInt32(4, false), -2);
  assert.deepEqual([...decodeGzipPayload(final)], [...pcm]);
});

test('ASR response parser handles sequence, final flag, gzip and current full text', () => {
  const payload = gzip(JSON.stringify({ result: { text: '完整转写' } }));
  const frame = new Uint8Array(12 + payload.byteLength);
  frame.set([0x11, 0x93, 0x11, 0x00]);
  const view = new DataView(frame.buffer);
  view.setInt32(4, 8, false);
  view.setUint32(8, payload.byteLength, false);
  frame.set(payload, 12);

  const decoded = decodeVolcAsrFrame(frame);
  assert.equal(decoded.type, 9);
  assert.equal(decoded.final, true);
  assert.equal(extractVolcAsrText(decoded.payload), '完整转写');
});

test('ASR error parser retains the server error code and message', () => {
  const payload = gzip(JSON.stringify({ message: 'denied' }));
  const frame = new Uint8Array(12 + payload.byteLength);
  frame.set([0x11, 0xf0, 0x11, 0x00]);
  const view = new DataView(frame.buffer);
  view.setInt32(4, 45000000, false);
  view.setUint32(8, payload.byteLength, false);
  frame.set(payload, 12);

  const decoded = decodeVolcAsrFrame(frame);
  assert.equal(decoded.type, 15);
  assert.equal(decoded.errorCode, 45000000);
  assert.equal(decoded.payload.message, 'denied');
});

test('ASR text extraction accepts the payload_msg envelope', () => {
  assert.equal(extractVolcAsrText({ payload_msg: { result: { text: '下一段' } } }), '下一段');
});

test('ASR URL upgrades HTTPS to WSS and selects either Agent Plan endpoint', () => {
  assert.equal(
    buildVolcAsrUrl('https://openspeech.bytedance.com'),
    'wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_async',
  );
  assert.equal(
    buildVolcAsrUrl('https://openspeech.bytedance.com', 'ws-unidirectional'),
    'wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_nostream',
  );
});

function decodeGzipPayload(frame: Uint8Array): Uint8Array {
  return ungzip(frame.subarray(12));
}
