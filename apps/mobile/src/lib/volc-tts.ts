import { toByteArray } from 'base64-js';

import { VOLC_TTS_DEFAULT_VOICE, type VolcTtsVoiceId } from './volc-tts-voices';

export { VOLC_TTS_DEFAULT_VOICE } from './volc-tts-voices';

export const VOLC_TTS_RESOURCE_ID = 'seed-tts-2.0';
export const VOLC_TTS_DEFAULT_ENDPOINT = 'https://openspeech.bytedance.com';

const TTS_PATH = '/api/v3/plan/tts/unidirectional';
const SUCCESS_CODE = 20_000_000;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

type FetchLike = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export type VolcTtsOptions = {
  apiKey: string;
  text: string;
  speaker?: VolcTtsVoiceId;
  endpoint?: string;
  signal?: AbortSignal;
};

export function buildVolcTtsUrl(endpoint = VOLC_TTS_DEFAULT_ENDPOINT): string {
  const normalized = endpoint.trim().replace(/\/+$/, '');
  return normalized.endsWith(TTS_PATH) ? normalized : `${normalized}${TTS_PATH}`;
}

export function parseVolcTtsChunks(body: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let completed = false;

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new Error('火山 TTS 返回了无法解析的数据。');
    }

    const code = typeof frame.code === 'number' ? frame.code : Number(frame.code ?? 0);
    if (typeof frame.data === 'string' && frame.data.length > 0) {
      const bytes = toByteArray(frame.data);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_AUDIO_BYTES) throw new Error('火山 TTS 返回的音频超过 64 MiB 安全上限。');
      chunks.push(bytes);
    }
    if (code === SUCCESS_CODE) {
      completed = true;
      continue;
    }
    if (code !== 0) {
      const message = typeof frame.message === 'string'
        ? frame.message
        : typeof frame.Message === 'string'
          ? frame.Message
          : `错误码 ${code}`;
      throw new Error(`火山 TTS 合成失败：${message}`);
    }
  }

  if (!completed) throw new Error('火山 TTS 未返回完成标记，音频已丢弃。');
  if (totalBytes === 0) throw new Error('火山 TTS 未返回音频内容。');

  const audio = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return audio;
}

export async function synthesizeVolcTts(
  options: VolcTtsOptions,
  fetchImpl: FetchLike = fetch,
): Promise<Uint8Array> {
  const apiKey = options.apiKey.trim();
  const text = options.text.trim();
  if (!apiKey) throw new Error('请先在语音设置中填写 Agent Plan API Key。');
  if (!text) throw new Error('没有可播报的文本。');

  const response = await fetchImpl(buildVolcTtsUrl(options.endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': VOLC_TTS_RESOURCE_ID,
    },
    body: JSON.stringify({
      req_params: {
        text,
        speaker: options.speaker?.trim() || VOLC_TTS_DEFAULT_VOICE,
        audio_params: { format: 'mp3', sample_rate: 24_000 },
      },
    }),
    signal: options.signal,
  });
  const body = await response.text();
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = JSON.parse(body) as Record<string, unknown>;
      const message = payload.message ?? payload.Message;
      if (typeof message === 'string' && message) detail = message;
    } catch {
      // Keep the HTTP status when the error body is not JSON.
    }
    throw new Error(`火山 TTS 请求失败：${detail}`);
  }
  return parseVolcTtsChunks(body);
}
