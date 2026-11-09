import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVolcTtsStreamUrl,
  decodeVolcTtsStreamFrame,
  encodeVolcTtsStreamRequest,
  isVolcTtsStreamFinished,
  volcTtsStreamError,
  VOLC_TTS_STREAM_PATH,
  openVolcTtsStream,
} from './volc-tts-stream';

test('streaming URL uses the Agent Plan unidirectional WebSocket path', () => {
  assert.equal(
    buildVolcTtsStreamUrl('https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional'),
    `wss://openspeech.bytedance.com${VOLC_TTS_STREAM_PATH}`,
  );
});

test('stream request encodes full text, voice and PCM/24 kHz without model override', () => {
  const frame = encodeVolcTtsStreamRequest({ apiKey: 'secret', text: '整段朗读', speaker: 'voice-a' });
  assert.deepEqual([...frame.slice(0, 4)], [0x11, 0x10, 0x10, 0]);
  const payloadLength = new DataView(frame.buffer).getUint32(4, false);
  const body = JSON.parse(new TextDecoder().decode(frame.slice(8)));
  assert.equal(payloadLength, frame.byteLength - 8);
  assert.equal(body.req_params.text, '整段朗读');
  assert.equal(body.req_params.speaker, 'voice-a');
  assert.deepEqual(body.req_params.audio_params, { format: 'pcm', sample_rate: 24000 });
  assert.equal(body.model, undefined);
  assert.equal(new TextDecoder().decode(frame).includes('secret'), false);
});

test('audio frame returns binary payload without interpreting it as JSON', () => {
  const audio = new Uint8Array([1, 2, 255, 0]);
  const frame = new Uint8Array(8 + audio.byteLength);
  frame.set([0x11, 0xb0, 0x00, 0]);
  new DataView(frame.buffer).setUint32(4, audio.byteLength, false);
  frame.set(audio, 8);
  const decoded = decodeVolcTtsStreamFrame(frame);
  assert.equal(decoded.type, 'audio');
  assert.deepEqual([...decoded.payload], [1, 2, 255, 0]);
});

test('session completion and server errors remain distinct', () => {
  const finished = new Uint8Array(16);
  finished.set([0x11, 0x94, 0x10, 0]);
  const view = new DataView(finished.buffer);
  view.setInt32(4, 152, false);
  view.setUint32(8, 0, false);
  view.setUint32(12, 0, false);
  const frame = decodeVolcTtsStreamFrame(finished);
  assert.equal(isVolcTtsStreamFinished(frame), true);
  assert.equal(volcTtsStreamError(frame), null);

  const message = new TextEncoder().encode('{"message":"denied"}');
  const error = new Uint8Array(12 + message.byteLength);
  error.set([0x11, 0xf0, 0x10, 0]);
  const errorView = new DataView(error.buffer);
  errorView.setUint32(4, 403, false);
  errorView.setUint32(8, message.byteLength, false);
  error.set(message, 12);
  assert.match(volcTtsStreamError(decodeVolcTtsStreamFrame(error))!.message, /403.*denied/);
});

test('truncated stream frames are rejected', () => {
  assert.throws(() => decodeVolcTtsStreamFrame(new Uint8Array([0x11, 0xb0])), /不完整/);
  assert.throws(() => decodeVolcTtsStreamFrame(new Uint8Array([0x11, 0xb0, 0, 0, 0, 0, 0, 4, 1])), /截断/);
});

test('WebSocket session streams audio until completion and abort stays silent', (context) => {
  const original = globalThis.WebSocket;
  class FakeWebSocket {
    static latest: FakeWebSocket | null = null;
    static sent: Uint8Array[] = [];
    binaryType = '';
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(..._args: unknown[]) { FakeWebSocket.latest = this; }
    send(data: Uint8Array): void { FakeWebSocket.sent.push(data); }
    close(): void { this.onclose?.(); }
  }
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  context.after(() => { globalThis.WebSocket = original; });
  const audio: number[][] = [];
  let finished = false;
  let failed = false;
  const session = openVolcTtsStream({ apiKey: 'secret', text: '你好' }, {
    onAudio: (pcm) => audio.push([...pcm]),
    onFinish: () => { finished = true; },
    onError: () => { failed = true; },
  });
  const socket = FakeWebSocket.latest!;
  socket.onopen?.();
  assert.equal(FakeWebSocket.sent.length, 1);
  const pcmFrame = new Uint8Array(10);
  pcmFrame.set([0x11, 0xb0, 0, 0, 0, 0, 0, 2, 1, 2]);
  socket.onmessage?.({ data: pcmFrame.buffer });
  assert.deepEqual(audio, [[1, 2]]);
  const done = new Uint8Array(16);
  done.set([0x11, 0x94, 0x10, 0]);
  new DataView(done.buffer).setInt32(4, 152, false);
  socket.onmessage?.({ data: done.buffer });
  assert.equal(finished, true);
  assert.equal(failed, false);
  session.abort();
  assert.equal(failed, false);
});

test('abort before completion closes without an error callback', (context) => {
  const original = globalThis.WebSocket;
  class FakeWebSocket {
    static latest: FakeWebSocket | null = null;
    binaryType = '';
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(..._args: unknown[]) { FakeWebSocket.latest = this; }
    send(_data: Uint8Array): void {}
    close(): void { this.onclose?.(); }
  }
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  context.after(() => { globalThis.WebSocket = original; });
  let failed = false;
  const session = openVolcTtsStream({ apiKey: 'secret', text: '取消' }, {
    onAudio: () => undefined,
    onFinish: () => undefined,
    onError: () => { failed = true; },
  });
  session.abort();
  assert.equal(failed, false);
});
