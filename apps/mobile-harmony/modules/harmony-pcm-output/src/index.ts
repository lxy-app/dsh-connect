import { requireOptionalNativeModule } from 'expo-modules-core';

export type HarmonyPcmOutputState = 'idle' | 'playing' | 'paused' | 'draining';
export type HarmonyPcmOutputEvents = {
  onStarted(event: { epoch: number; sampleRate: 24000; channels: 1 }): void;
  onFinished(event: { epoch: number }): void;
  onError(event: { epoch: number; message: string }): void;
  onStateChange(event: { epoch: number; state: HarmonyPcmOutputState }): void;
};
type Subscription = { remove(): void };
type NativeModule = {
  start(rate: number): Promise<number>;
  write(pcm: ArrayBuffer): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  finish(): Promise<void>;
  stop(): Promise<void>;
  addListener<K extends keyof HarmonyPcmOutputEvents>(event: K, listener: HarmonyPcmOutputEvents[K]): Subscription;
};

const native = requireOptionalNativeModule<NativeModule>('HarmonyPcmOutput');
const inertSubscription: Subscription = { remove() {} };

export const HarmonyPcmOutputNative = {
  isAvailable: native !== null,
  async start(rate = 1): Promise<number> {
    if (!native) throw new Error('HarmonyPcmOutput native module is not installed; rebuild the HAP.');
    if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) throw new Error('Harmony PCM rate must be 0.25–4.0.');
    return native.start(rate);
  },
  async write(pcm: ArrayBuffer): Promise<void> {
    if (!native) throw new Error('HarmonyPcmOutput native module is not installed; rebuild the HAP.');
    await native.write(pcm);
  },
  async pause(): Promise<void> { await native?.pause(); },
  async resume(): Promise<void> { await native?.resume(); },
  async finish(): Promise<void> { await native?.finish(); },
  async stop(): Promise<void> { await native?.stop(); },
  addListener<K extends keyof HarmonyPcmOutputEvents>(event: K, listener: HarmonyPcmOutputEvents[K]): Subscription {
    return native?.addListener(event, listener) ?? inertSubscription;
  },
};
