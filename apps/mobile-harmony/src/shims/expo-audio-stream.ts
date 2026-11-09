import { useEffect, useMemo, useRef, useState } from 'react';

import { HarmonyAudioStreamNative } from '../../modules/harmony-audio-stream';
import { PcmChunker } from '@/lib/pcm-chunker';

export const HARMONY_AUDIO_STREAM_UNAVAILABLE = '当前鸿蒙安装包未包含实时语音模块，请重新构建并安装 HAP。';

export type HarmonyAudioStreamBuffer = {
  data: ArrayBuffer;
  sampleRate: number;
  channels: number;
  timestamp: number;
};

export type HarmonyAudioStreamOptions = {
  sampleRate?: number;
  channels?: number;
  encoding?: 'float32' | 'int16';
  onBuffer?: (buffer: HarmonyAudioStreamBuffer) => void;
  onError?: (error: Error) => void;
  onStateChange?: (isStreaming: boolean) => void;
};

export type HarmonyAudioStream = {
  readonly isSupported: boolean;
  readonly isStreaming: boolean;
  readonly sampleRate: number;
  readonly channels: number;
  start: () => Promise<void>;
  stop: () => void;
  dispose: () => void;
};

export function createHarmonyAudioStream(options: HarmonyAudioStreamOptions = {}): HarmonyAudioStream {
  const chunker = new PcmChunker();
  let active = false;
  let disposed = false;

  const emit = (data: Uint8Array, timestamp: number) => {
    options.onBuffer?.({
      data: data.buffer as ArrayBuffer,
      sampleRate: HarmonyAudioStreamNative.sampleRate,
      channels: HarmonyAudioStreamNative.channels,
      timestamp,
    });
  };
  const flush = () => {
    const tail = chunker.flush();
    if (tail) emit(tail, 0);
  };
  const reportError = (cause: unknown) => {
    options.onError?.(cause instanceof Error ? cause : new Error('鸿蒙麦克风采集失败。'));
  };
  const fail = (cause: unknown) => {
    active = false;
    chunker.reset();
    void HarmonyAudioStreamNative.stop().catch(() => undefined);
    reportError(cause);
  };

  const pcmSubscription = HarmonyAudioStreamNative.addListener('onPcmData', (event) => {
    if (!active || disposed) return;
    try {
      if (event.sampleRate !== HarmonyAudioStreamNative.sampleRate || event.channels !== HarmonyAudioStreamNative.channels) {
        throw new Error(`当前麦克风输出为 ${event.sampleRate} Hz / ${event.channels} 声道，无法按 16 kHz 单声道识别。`);
      }
      for (const chunk of chunker.push(new Uint8Array(event.data))) emit(chunk, event.timestamp);
    } catch (cause) {
      fail(cause);
    }
  });
  const errorSubscription = HarmonyAudioStreamNative.addListener('onError', (event) => {
    if (disposed) return;
    fail(new Error(event.message));
  });
  const stateSubscription = HarmonyAudioStreamNative.addListener('onStateChange', (event) => {
    if (!disposed) options.onStateChange?.(event.isStreaming);
  });

  return {
    isSupported: HarmonyAudioStreamNative.isAvailable,
    get isStreaming() {
      return active && !disposed;
    },
    sampleRate: HarmonyAudioStreamNative.sampleRate,
    channels: HarmonyAudioStreamNative.channels,
    async start() {
      if (!HarmonyAudioStreamNative.isAvailable) throw new Error(HARMONY_AUDIO_STREAM_UNAVAILABLE);
      if (disposed) throw new Error('实时语音模块已释放，请重新进入会话。');
      if (active) return;
      chunker.reset();
      active = true;
      try {
        await HarmonyAudioStreamNative.start();
      } catch (cause) {
        active = false;
        chunker.reset();
        throw cause;
      }
    },
    stop() {
      if (disposed) return;
      const shouldStopNative = active;
      active = false;
      flush();
      if (shouldStopNative) void HarmonyAudioStreamNative.stop().catch(reportError);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      chunker.reset();
      pcmSubscription.remove();
      errorSubscription.remove();
      stateSubscription.remove();
      void HarmonyAudioStreamNative.stop().catch(() => undefined);
    },
  };
}

export function useAudioStream(options: HarmonyAudioStreamOptions): {
  stream: HarmonyAudioStream;
  isStreaming: boolean;
} {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [isStreaming, setIsStreaming] = useState(false);
  const stream = useMemo(() => createHarmonyAudioStream({
    onBuffer: (buffer) => optionsRef.current.onBuffer?.(buffer),
    onError: (error) => optionsRef.current.onError?.(error),
    onStateChange: setIsStreaming,
  }), []);
  useEffect(() => () => stream.dispose(), [stream]);
  return { stream, isStreaming };
}
