import { HarmonyPcmOutputNative } from '../../modules/harmony-pcm-output';
import { PcmStreamChunker } from '@shared/lib/pcm-stream';
import { publishVolcPcm, readCachedVolcPcm } from '@/lib/volc-tts-cache';
import {
  openVolcTtsStream,
  type VolcTtsStreamOptions,
  type VolcTtsStreamSession,
} from '@/lib/volc-tts-stream';

const MAX_STREAM_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_PENDING_PCM_BYTES = 16 * 1024 * 1024;
const CACHED_PCM_WRITE_BYTES = 24_000 * 2;

type Handlers = {
  onPlaying: () => void;
  onPaused: () => void;
  onFinished: () => void;
  onError: (cause: Error) => void;
};

type Subscription = { remove(): void };

/** Harmony's single native AudioRenderer consumes PCM without changing WAV files between frames. */
export class HarmonyStreamPlayer {
  private session: VolcTtsStreamSession | null = null;
  private readonly listeners: Subscription[] = [];
  private readonly chunker = new PcmStreamChunker(24_000 * 2);
  private writeTail: Promise<void> = Promise.resolve();
  private readonly audioChunks: Uint8Array[] = [];
  private audioBytes = 0;
  private pendingBytes = 0;
  private fromCache = false;
  private inputFinished = false;
  private started = false;
  private nativeEpoch: number | null = null;
  private stopped = false;
  private failed = false;
  private streamFailure = false;
  private startSettled = false;
  private startResolve: (() => void) | null = null;
  private startReject: ((cause: Error) => void) | null = null;
  private startPromise: Promise<void> = Promise.resolve();
  private startedAt = 0;
  private firstAudioAt = 0;

  constructor(
    private readonly options: VolcTtsStreamOptions,
    private readonly rate: number,
    private readonly applyPlaybackMode: () => Promise<void>,
    private readonly handlers: Handlers,
  ) {}

  get canFallbackToHttp(): boolean {
    // The native renderer could already own audio before its start event reaches JS.
    return this.firstAudioAt === 0 && !this.started && !this.streamFailure;
  }

  static get isAvailable(): boolean {
    return HarmonyPcmOutputNative.isAvailable;
  }

  async start(): Promise<void> {
    if (!HarmonyPcmOutputNative.isAvailable) throw new Error('鸿蒙连续 PCM 播放模块尚未安装。');
    this.startedAt = Date.now();
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
    });
    // stop() may reject while cache lookup or native initialization is pending.
    void this.startPromise.catch(() => undefined);
    try {
      await this.applyPlaybackMode();
      if (this.stopped) await this.startPromise;
      const cached = await readCachedVolcPcm(this.options);
      if (this.stopped) await this.startPromise;
      this.nativeEpoch = await HarmonyPcmOutputNative.start(this.rate);
      if (this.stopped) await this.startPromise;
      this.listeners.push(
        HarmonyPcmOutputNative.addListener('onStarted', (event) => {
          if (this.stopped || this.failed || event.epoch !== this.nativeEpoch) return;
          this.started = true;
          if (__DEV__) console.info('[TTS] harmony_pcm', {
            firstFrameMs: this.firstAudioAt - this.startedAt,
            rendererStartMs: Date.now() - this.startedAt,
          });
          this.resolveStart();
          this.handlers.onPlaying();
        }),
        HarmonyPcmOutputNative.addListener('onFinished', (event) => {
          if (this.stopped || this.failed || event.epoch !== this.nativeEpoch) return;
          void this.stop().then(() => this.handlers.onFinished()).catch((cause: unknown) => {
            this.handlers.onError(cause instanceof Error ? cause : new Error('鸿蒙播放器释放失败。'));
          });
        }),
        HarmonyPcmOutputNative.addListener('onError', (event) => {
          if (event.epoch === this.nativeEpoch) this.fail(new Error(event.message || '鸿蒙音频输出失败。'));
        }),
        HarmonyPcmOutputNative.addListener('onStateChange', (event) => {
          if (this.stopped || this.failed || event.epoch !== this.nativeEpoch || !this.started) return;
          if (event.state === 'paused') this.handlers.onPaused();
          else if (event.state === 'playing') this.handlers.onPlaying();
        }),
      );
      if (cached) {
        this.fromCache = true;
        void this.playCached(cached);
      } else {
        this.session = openVolcTtsStream(this.options, {
          onAudio: (pcm) => this.enqueueAudio(pcm),
          onFinish: () => { void this.finishInput(); },
          onError: (cause) => {
            // Server/protocol errors are not healed by a second paid HTTP synthesis.
            this.streamFailure = !cause.message.startsWith('火山 TTS 流式连接失败');
            this.fail(cause);
          },
        });
      }
      await this.startPromise;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('流式音频初始化失败。');
      await this.stop();
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (!this.started || this.stopped || this.failed) return;
    await HarmonyPcmOutputNative.pause();
    if (!this.stopped) this.handlers.onPaused();
  }

  async resume(): Promise<void> {
    if (!this.started || this.stopped || this.failed) return;
    await HarmonyPcmOutputNative.resume();
    if (!this.stopped) this.handlers.onPlaying();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.session?.abort();
    this.session = null;
    if (!this.startSettled) this.rejectStart(new Error('播放已停止。'));
    for (const listener of this.listeners.splice(0)) listener.remove();
    this.audioChunks.length = 0;
    await HarmonyPcmOutputNative.stop();
  }

  private async playCached(audio: Uint8Array): Promise<void> {
    try {
      for (let offset = 0; offset < audio.byteLength && !this.stopped; offset += CACHED_PCM_WRITE_BYTES) {
        this.enqueueAudio(audio.subarray(offset, offset + CACHED_PCM_WRITE_BYTES));
        await this.writeTail;
      }
      if (!this.stopped && !this.failed) await this.finishInput();
    } catch (cause) {
      this.fail(cause instanceof Error ? cause : new Error('缓存音频播放失败。'));
    }
  }

  private enqueueAudio(pcm: Uint8Array): void {
    if (this.stopped || this.failed || this.inputFinished || pcm.byteLength === 0) return;
    if (this.firstAudioAt === 0) this.firstAudioAt = Date.now();
    this.audioBytes += pcm.byteLength;
    if (this.audioBytes > MAX_STREAM_AUDIO_BYTES) {
      this.fail(new Error('流式音频超过 64 MiB 安全上限。'));
      return;
    }
    // The decoder's buffer may be reused; both cache publication and native writes own a copy.
    const copy = pcm.slice();
    if (!this.fromCache) this.audioChunks.push(copy);
    // Network frames may end halfway through one 16-bit sample; align them before native writes.
    for (const aligned of this.chunker.push(copy)) {
      if (this.pendingBytes + aligned.byteLength > MAX_PENDING_PCM_BYTES) {
        this.fail(new Error('朗读音频到达速度超过设备播放能力，请重试。'));
        return;
      }
      this.pendingBytes += aligned.byteLength;
      const buffer = aligned.buffer.slice(aligned.byteOffset, aligned.byteOffset + aligned.byteLength) as ArrayBuffer;
      this.writeTail = this.writeTail.then(async () => {
        if (!this.stopped && !this.failed) await HarmonyPcmOutputNative.write(buffer);
      }).finally(() => {
        this.pendingBytes -= aligned.byteLength;
      });
      void this.writeTail.catch((cause: unknown) => {
        this.fail(cause instanceof Error ? cause : new Error('鸿蒙 PCM 音频写入失败。'));
      });
    }
  }

  private async finishInput(): Promise<void> {
    if (this.stopped || this.failed || this.inputFinished) return;
    this.inputFinished = true;
    try {
      this.chunker.flush();
      await this.writeTail;
      if (this.stopped || this.failed) return;
      if (this.audioBytes === 0) throw new Error('火山 TTS 未返回音频内容。');
      if (!this.fromCache) this.publishCompleteAudio();
      await HarmonyPcmOutputNative.finish();
    } catch (cause) {
      this.fail(cause instanceof Error ? cause : new Error('鸿蒙 PCM 音频结束处理失败。'));
    }
  }

  private publishCompleteAudio(): void {
    const complete = new Uint8Array(this.audioBytes);
    let offset = 0;
    for (const chunk of this.audioChunks) {
      complete.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.audioChunks.length = 0;
    void publishVolcPcm(this.options, complete).catch(() => undefined);
  }

  private fail(cause: Error): void {
    if (this.stopped || this.failed) return;
    this.failed = true;
    this.session?.abort();
    if (this.startSettled) this.handlers.onError(cause);
    else this.rejectStart(cause);
    void this.stop().catch(() => undefined);
  }

  private resolveStart(): void {
    if (this.startSettled) return;
    this.startSettled = true;
    this.startResolve?.();
  }

  private rejectStart(cause: Error): void {
    if (this.startSettled) return;
    this.startSettled = true;
    this.startReject?.(cause);
  }
}
