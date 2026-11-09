import { gzip, ungzip } from 'pako';

export const VOLC_ASR_RESOURCE_ID = 'volc.seedasr.sauc.duration';
export const VOLC_ASR_DEFAULT_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_async';

export type VolcAsrProtocol = 'ws-bidirectional' | 'ws-unidirectional';

const ASR_PATHS: Record<VolcAsrProtocol, string> = {
  'ws-bidirectional': '/api/v3/plan/sauc/bigmodel_async',
  'ws-unidirectional': '/api/v3/plan/sauc/bigmodel_nostream',
};
const SERVER_FULL_RESPONSE = 9;
const SERVER_ERROR_RESPONSE = 15;

export type VolcAsrHandlers = {
  onOpen: () => void;
  onText: (text: string) => void;
  onComplete: (text: string) => void;
  onError: (error: Error) => void;
};

export type VolcAsrSession = {
  sendAudio: (pcm: ArrayBuffer | Uint8Array) => void;
  finish: (lastPcm?: ArrayBuffer | Uint8Array) => void;
  abort: () => void;
};

type ParsedServerFrame = {
  type: number;
  flags: number;
  final: boolean;
  errorCode?: number;
  payload: Record<string, unknown>;
};

export function buildVolcAsrUrl(endpoint?: string, protocol: VolcAsrProtocol = 'ws-bidirectional'): string {
  if (!endpoint?.trim()) return protocol === 'ws-unidirectional'
    ? VOLC_ASR_DEFAULT_ENDPOINT.replace('bigmodel_async', 'bigmodel_nostream')
    : VOLC_ASR_DEFAULT_ENDPOINT;
  const url = new URL(endpoint);
  if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol)) {
    throw new Error('火山 ASR 地址必须使用 HTTPS 或 WSS。');
  }
  url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
  url.pathname = ASR_PATHS[protocol];
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function encodeVolcAsrFrame(
  payload: string | Uint8Array,
  sequence: number,
  kind: 'request' | 'audio' = 'audio',
): Uint8Array {
  const compressed = gzip(payload);
  const frame = new Uint8Array(12 + compressed.byteLength);
  const finalAudio = kind === 'audio' && sequence < 0;
  frame.set([
    0x11,
    kind === 'request' ? 0x11 : finalAudio ? 0x23 : 0x21,
    0x11,
    0x00,
  ]);
  const view = new DataView(frame.buffer);
  view.setInt32(4, sequence, false);
  view.setUint32(8, compressed.byteLength, false);
  frame.set(compressed, 12);
  return frame;
}

export function decodeVolcAsrFrame(input: ArrayBuffer | Uint8Array): ParsedServerFrame {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 4) throw new Error('火山 ASR 返回了不完整的数据帧。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = (bytes[0] & 0x0f) * 4;
  if (headerSize < 4 || bytes.byteLength < headerSize) throw new Error('火山 ASR 数据帧头无效。');

  const type = bytes[1] >> 4;
  const flags = bytes[1] & 0x0f;
  const serialization = bytes[2] >> 4;
  const compression = bytes[2] & 0x0f;
  let offset = headerSize;
  if (flags & 0x01) offset += 4;
  if (flags & 0x04) offset += 4;
  let errorCode: number | undefined;
  if (type === SERVER_ERROR_RESPONSE) {
    errorCode = view.getInt32(offset, false);
    offset += 4;
  }
  if (offset + 4 > bytes.byteLength) throw new Error('火山 ASR 数据帧长度无效。');
  const payloadSize = view.getUint32(offset, false);
  offset += 4;
  if (offset + payloadSize > bytes.byteLength) throw new Error('火山 ASR 数据帧内容被截断。');

  let payloadBytes = bytes.subarray(offset, offset + payloadSize);
  if (compression === 1 && payloadBytes.byteLength > 0) payloadBytes = ungzip(payloadBytes);
  let payload: Record<string, unknown> = {};
  if (payloadBytes.byteLength > 0) {
    if (serialization !== 1) throw new Error('火山 ASR 返回了不支持的序列化格式。');
    const text = new TextDecoder().decode(payloadBytes);
    payload = JSON.parse(text) as Record<string, unknown>;
  }
  return { type, flags, final: (flags & 0x02) !== 0, errorCode, payload };
}

export function extractVolcAsrText(payload: Record<string, unknown>): string {
  const envelope = isRecord(payload.payload_msg) ? payload.payload_msg : payload;
  const result = envelope.result ?? payload.result;
  if (isRecord(result) && typeof result.text === 'string') return result.text;
  if (Array.isArray(result)) {
    const first = result.find(isRecord);
    if (first && typeof first.text === 'string') return first.text;
  }
  return typeof envelope.text === 'string' ? envelope.text : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requestId(): string {
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (token) => {
    const value = Number(token);
    return (value ^ Math.floor(Math.random() * 16) >> (value / 4)).toString(16);
  });
}

export function openVolcAsrSession(
  options: { apiKey: string; endpoint?: string; protocol?: VolcAsrProtocol },
  handlers: VolcAsrHandlers,
): VolcAsrSession {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('请先在语音设置中填写 Agent Plan API Key。');
  const id = requestId();
  const RNWebSocket = WebSocket as unknown as new (
    target: string,
    protocols?: string | string[],
    options?: { headers?: Record<string, string> },
  ) => WebSocket;
  const socket = new RNWebSocket(buildVolcAsrUrl(options.endpoint, options.protocol), undefined, {
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': VOLC_ASR_RESOURCE_ID,
      'X-Api-Request-Id': id,
      'X-Api-Connect-Id': id,
      'X-Api-Sequence': '-1',
    },
  });
  socket.binaryType = 'arraybuffer';

  let sequence = 1;
  let finished = false;
  let completed = false;
  let aborted = false;
  let latestText = '';

  const closeSocket = () => {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  };
  const fail = (error: Error) => {
    if (completed || aborted) return;
    completed = true;
    handlers.onError(error);
    closeSocket();
  };

  socket.onopen = () => {
    if (aborted || completed) return;
    try {
      const request = JSON.stringify({
        user: { uid: 'app-user' },
        audio: { format: 'pcm', codec: 'raw', rate: 16_000, bits: 16, channel: 1 },
        request: {
          model_name: 'bigmodel',
          result_type: 'full',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: true,
          show_utterances: true,
        },
      });
      socket.send(encodeVolcAsrFrame(request, sequence, 'request'));
      sequence = 2;
      handlers.onOpen();
    } catch (cause) {
      fail(cause instanceof Error ? cause : new Error('无法初始化火山 ASR。'));
    }
  };

  socket.onmessage = (event) => {
    if (completed || aborted) return;
    try {
      if (typeof event.data === 'string') throw new Error('火山 ASR 返回了非二进制数据。');
      const frame = decodeVolcAsrFrame(event.data as ArrayBuffer);
      if (frame.type === SERVER_ERROR_RESPONSE || frame.errorCode) {
        const message = frame.payload.message ?? frame.payload.Message;
        throw new Error(`火山 ASR 识别失败（${frame.errorCode ?? '未知错误'}）：${typeof message === 'string' ? message : '服务端拒绝请求'}`);
      }
      if (frame.type !== SERVER_FULL_RESPONSE) return;
      const text = extractVolcAsrText(frame.payload).trim();
      if (text) {
        latestText = text;
        handlers.onText(text);
      }
      if (frame.final) {
        completed = true;
        handlers.onComplete(latestText);
        closeSocket();
      }
    } catch (cause) {
      fail(cause instanceof Error ? cause : new Error('火山 ASR 响应解析失败。'));
    }
  };
  socket.onerror = () => fail(new Error('火山 ASR 连接失败，请检查网络、API Key 和套餐权限。'));
  socket.onclose = () => {
    if (!completed && !aborted) fail(new Error('火山 ASR 在返回最终结果前断开了连接。'));
  };

  return {
    sendAudio: (pcm) => {
      if (completed || aborted || finished) return;
      if (socket.readyState !== WebSocket.OPEN) throw new Error('火山 ASR 尚未连接。');
      const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
      socket.send(encodeVolcAsrFrame(bytes, sequence));
      sequence += 1;
    },
    finish: (lastPcm) => {
      if (completed || aborted || finished) return;
      if (socket.readyState !== WebSocket.OPEN) throw new Error('火山 ASR 尚未连接。');
      finished = true;
      const bytes = lastPcm instanceof Uint8Array
        ? lastPcm
        : lastPcm
          ? new Uint8Array(lastPcm)
          : new Uint8Array();
      socket.send(encodeVolcAsrFrame(bytes, -sequence));
      sequence += 1;
    },
    abort: () => {
      if (completed || aborted) return;
      aborted = true;
      closeSocket();
    },
  };
}
