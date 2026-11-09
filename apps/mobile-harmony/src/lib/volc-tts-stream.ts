import { ungzip } from 'pako';

import { VOLC_TTS_DEFAULT_ENDPOINT, VOLC_TTS_DEFAULT_VOICE, VOLC_TTS_RESOURCE_ID } from '@/lib/volc-tts';

export const VOLC_TTS_STREAM_PATH = '/api/v3/plan/tts/unidirectional/stream';
export const VOLC_TTS_STREAM_SAMPLE_RATE = 24_000;

const FULL_CLIENT_REQUEST = 0b0001;
const FULL_SERVER_RESPONSE = 0b1001;
const AUDIO_ONLY_SERVER = 0b1011;
const ERROR_RESPONSE = 0b1111;
const WITH_EVENT = 0b0100;
const SESSION_FAILED = 153;
const SESSION_FINISHED = 152;

export type VolcTtsStreamOptions = {
  apiKey: string;
  text: string;
  speaker?: string;
  endpoint?: string;
};

export type VolcTtsStreamFrame = {
  type: 'audio' | 'response' | 'error';
  event: number;
  payload: Uint8Array;
  errorCode?: number;
};

export function buildVolcTtsStreamUrl(endpoint = VOLC_TTS_DEFAULT_ENDPOINT): string {
  const url = new URL(endpoint);
  if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol)) {
    throw new Error('火山 TTS 流式地址必须使用 HTTPS 或 WSS。');
  }
  url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
  url.pathname = VOLC_TTS_STREAM_PATH;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function encodeVolcTtsStreamRequest(options: VolcTtsStreamOptions): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify({
    req_params: {
      text: options.text.trim(),
      speaker: options.speaker?.trim() || VOLC_TTS_DEFAULT_VOICE,
      audio_params: { format: 'pcm', sample_rate: VOLC_TTS_STREAM_SAMPLE_RATE },
    },
  }));
  const frame = new Uint8Array(8 + payload.byteLength);
  frame.set([0x11, FULL_CLIENT_REQUEST << 4, 0x10, 0x00]);
  new DataView(frame.buffer).setUint32(4, payload.byteLength, false);
  frame.set(payload, 8);
  return frame;
}

export function decodeVolcTtsStreamFrame(input: ArrayBuffer | Uint8Array): VolcTtsStreamFrame {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 4) throw new Error('火山 TTS 返回了不完整的数据帧。');
  const reader = new FrameReader(bytes);
  const versionAndHeader = reader.byte();
  const version = versionAndHeader >> 4;
  const headerSize = (versionAndHeader & 0x0f) * 4;
  if (version !== 1 || headerSize < 4) throw new Error('火山 TTS 返回了不支持的数据帧版本。');
  const typeAndFlags = reader.byte();
  const type = typeAndFlags >> 4;
  const flags = typeAndFlags & 0x0f;
  const serialization = reader.byte();
  const compression = serialization & 0x0f;
  reader.skip(headerSize - 3);
  if ((flags & 0b0001) !== 0) reader.int32();
  let errorCode: number | undefined;
  if (type === ERROR_RESPONSE) errorCode = reader.uint32();
  let event = 0;
  if ((flags & WITH_EVENT) !== 0) {
    event = reader.int32();
    if (![1, 2, 50, 51, 52].includes(event)) reader.string();
    if ([50, 51, 52].includes(event)) reader.string();
  }
  const payload = reader.bytes(reader.uint32());
  if (reader.remaining !== 0) throw new Error('火山 TTS 数据帧包含意外的尾随内容。');
  const decoded = compression === 1 ? ungzip(payload) : payload;
  if (type === AUDIO_ONLY_SERVER) return { type: 'audio', event, payload: decoded };
  if (type === FULL_SERVER_RESPONSE) return { type: 'response', event, payload: decoded };
  if (type === ERROR_RESPONSE) return { type: 'error', event, payload: decoded, errorCode };
  throw new Error(`火山 TTS 返回了未知消息类型 ${type}。`);
}

export function isVolcTtsStreamFinished(frame: VolcTtsStreamFrame): boolean {
  return frame.type === 'response' && frame.event === SESSION_FINISHED;
}

export function volcTtsStreamError(frame: VolcTtsStreamFrame): Error | null {
  if (frame.type !== 'error' && !(frame.type === 'response' && frame.event === SESSION_FAILED)) return null;
  const raw = new TextDecoder().decode(frame.payload).trim();
  let detail = raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const message = parsed.message ?? parsed.Message;
    if (typeof message === 'string') detail = message;
  } catch {
    // Preserve a non-JSON server message as-is.
  }
  const code = frame.errorCode === undefined ? '' : `（错误码 ${frame.errorCode}）`;
  return new Error(`火山 TTS 流式合成失败${code}${detail ? `：${detail}` : ''}`);
}

export type VolcTtsStreamHandlers = {
  onAudio: (pcm: Uint8Array) => void;
  onFinish: () => void;
  onError: (cause: Error) => void;
};

export type VolcTtsStreamSession = { abort: () => void };

export function openVolcTtsStream(
  options: VolcTtsStreamOptions,
  handlers: VolcTtsStreamHandlers,
): VolcTtsStreamSession {
  if (!options.apiKey.trim()) throw new Error('请先在语音设置中填写 Agent Plan API Key。');
  if (!options.text.trim()) throw new Error('没有可播报的文本。');
  const RNWebSocket = WebSocket as unknown as new (
    target: string,
    protocols?: string | string[],
    options?: { headers?: Record<string, string> },
  ) => WebSocket;
  const socket = new RNWebSocket(buildVolcTtsStreamUrl(options.endpoint), undefined, {
    headers: {
      'X-Api-Key': options.apiKey.trim(),
      'X-Api-Resource-Id': VOLC_TTS_RESOURCE_ID,
    },
  });
  socket.binaryType = 'arraybuffer';
  let aborted = false;
  let finished = false;
  let failed = false;
  let audioReceived = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const clearIdleTimeout = () => {
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
  };
  const armIdleTimeout = (milliseconds: number, message: string) => {
    clearIdleTimeout();
    timeout = setTimeout(() => fail(new Error(message)), milliseconds);
  };
  armIdleTimeout(60_000, '火山 TTS 流式首音频等待超时，请检查网络后重试。');
  const fail = (cause: Error) => {
    if (aborted || failed || finished) return;
    failed = true;
    clearIdleTimeout();
    socket.close();
    handlers.onError(cause);
  };
  socket.onopen = () => {
    try {
      socket.send(encodeVolcTtsStreamRequest(options));
    } catch (cause) {
      fail(cause instanceof Error ? cause : new Error('无法发送火山 TTS 请求。'));
    }
  };
  socket.onmessage = (event) => {
    if (aborted || failed || finished) return;
    armIdleTimeout(30_000, '火山 TTS 流式音频接收超时，请检查网络后重试。');
    try {
      if (!(event.data instanceof ArrayBuffer) && !(event.data instanceof Uint8Array)) {
        throw new Error('火山 TTS 返回了非二进制音频数据。');
      }
      const frame = decodeVolcTtsStreamFrame(event.data);
      const error = volcTtsStreamError(frame);
      if (error) throw error;
      if (frame.type === 'audio' && frame.payload.byteLength > 0) {
        audioReceived = true;
        handlers.onAudio(frame.payload);
      }
      if (isVolcTtsStreamFinished(frame)) {
        if (!audioReceived) throw new Error('火山 TTS 未返回音频内容。');
        finished = true;
        clearIdleTimeout();
        socket.close();
        handlers.onFinish();
      }
    } catch (cause) {
      fail(cause instanceof Error ? cause : new Error('火山 TTS 流式数据处理失败。'));
    }
  };
  socket.onerror = () => fail(new Error('火山 TTS 流式连接失败，请检查网络与专属 Key。'));
  socket.onclose = () => {
    if (!aborted && !finished && !failed) fail(new Error('火山 TTS 流式连接在音频完成前中断。'));
  };
  return {
    abort: () => {
      aborted = true;
      clearIdleTimeout();
      socket.close();
    },
  };
}

class FrameReader {
  offset = 0;
  private readonly view: DataView;
  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  get remaining(): number { return this.data.byteLength - this.offset; }
  byte(): number { this.ensure(1); return this.view.getUint8(this.offset++); }
  skip(count: number): void { this.ensure(count); this.offset += count; }
  int32(): number { const value = this.view.getInt32(this.offset, false); this.skip(4); return value; }
  uint32(): number { const value = this.view.getUint32(this.offset, false); this.skip(4); return value; }
  string(): string { return new TextDecoder().decode(this.bytes(this.uint32())); }
  bytes(count: number): Uint8Array {
    this.ensure(count);
    const value = this.data.slice(this.offset, this.offset + count);
    this.offset += count;
    return value;
  }
  private ensure(count: number): void {
    if (count < 0 || this.remaining < count) throw new Error('火山 TTS 返回了截断的数据帧。');
  }
}
