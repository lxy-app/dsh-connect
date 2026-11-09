import { requireOptionalNativeModule } from 'expo-modules-core';

export type HarmonyAudioStreamBufferEvent = {
  data: ArrayBuffer;
  sampleRate: number;
  channels: number;
  timestamp: number;
};

export type HarmonyAudioStreamErrorEvent = {
  message: string;
};

export type HarmonyAudioStreamStateEvent = {
  isStreaming: boolean;
};

export type HarmonyAudioStreamEvents = {
  onPcmData(event: HarmonyAudioStreamBufferEvent): void;
  onError(event: HarmonyAudioStreamErrorEvent): void;
  onStateChange(event: HarmonyAudioStreamStateEvent): void;
};

type Subscription = { remove(): void };
type HarmonyAudioStreamNativeModule = {
  readonly platform: 'harmony';
  readonly sampleRate: 16_000;
  readonly channels: 1;
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener<EventName extends keyof HarmonyAudioStreamEvents>(
    eventName: EventName,
    listener: HarmonyAudioStreamEvents[EventName],
  ): Subscription;
};

const nativeModule = requireOptionalNativeModule<HarmonyAudioStreamNativeModule>('HarmonyAudioStream');
const inertSubscription: Subscription = { remove() {} };

export const HarmonyAudioStreamNative = {
  isAvailable: nativeModule !== null,
  sampleRate: 16_000,
  channels: 1,
  async start(): Promise<void> {
    if (!nativeModule) throw new Error('HarmonyAudioStream native module is not installed.');
    await nativeModule.start();
  },
  async stop(): Promise<void> {
    await nativeModule?.stop();
  },
  addListener<EventName extends keyof HarmonyAudioStreamEvents>(
    eventName: EventName,
    listener: HarmonyAudioStreamEvents[EventName],
  ): Subscription {
    return nativeModule?.addListener(eventName, listener) ?? inertSubscription;
  },
};
