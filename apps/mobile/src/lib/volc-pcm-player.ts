import {
  createAudioPlaylist,
  setAudioModeAsync,
  type AudioPlaylist,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import { PLAYBACK_AUDIO_MODE } from '@/lib/audio-session';
import { PcmStreamChunker, wrapPcmInWav } from '@shared/lib/pcm-stream';
import { publishVolcPcm, readCachedVolcPcm } from '@/lib/volc-tts-cache';
import {
  openVolcTtsStream,
  VOLC_TTS_STREAM_SAMPLE_RATE,
  type VolcTtsStreamOptions,
  type VolcTtsStreamSession,
} from '@/lib/volc-tts-stream';

const MAX_STREAM_AUDIO_BYTES = 64 * 1024 * 1024;
const PLAYBACK_BUFFER_SAMPLES = VOLC_TTS_STREAM_SAMPLE_RATE;

/** Stream PCM through WAV items on the native gapless Expo audio playlist. */
export class VolcPcmPlayer {
  private session: VolcTtsStreamSession | null = null;
  private playlist: AudioPlaylist | null = null;
  private readonly chunker = new PcmStreamChunker(PLAYBACK_BUFFER_SAMPLES * 2);
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly files = new Map<number, string>();
  private queuedCount = 0;
  private fileSequence = 0;
  private readonly audioChunks: Uint8Array[] = [];
  private audioBytes = 0;
  private fromCache = false;
  private started = false;
  private paused = false;
  private inputFinished = false;
  private waitingForNext = false;
  private stopped = false;
  private failed = false;
  private startSettled = false;
  private startResolve: (() => void) | null = null;
  private startReject: ((cause: Error) => void) | null = null;
  private startPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: VolcTtsStreamOptions,
    private readonly rate: number,
    private readonly handlers: PlayerHandlers,
  ) {}

  async start(): Promise<void> {
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
    });
    void this.startPromise.catch(() => undefined);
    try {
      await setAudioModeAsync(PLAYBACK_AUDIO_MODE);
      const cached = await readCachedVolcPcm(this.options);
      if (this.stopped) await this.startPromise;
      if (cached) {
        this.fromCache = true;
        this.enqueuePcm(cached);
        await this.writeQueue;
        await this.finishInput();
      } else {
        this.session = openVolcTtsStream(this.options, {
          onAudio: (pcm) => this.enqueueNetworkAudio(pcm),
          onFinish: () => { void this.finishInput(); },
          onError: (cause) => this.fail(cause),
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
    if (!this.started || this.paused || this.stopped || this.failed) return;
    this.paused = true;
    this.playlist?.pause();
    this.handlers.onPaused();
  }

  async resume(): Promise<void> {
    if (!this.started || !this.paused || this.stopped || this.failed) return;
    const playlist = this.playlist;
    if (!playlist) return;
    this.paused = false;
    if (this.waitingForNext && playlist.currentIndex + 1 < playlist.trackCount) {
      playlist.next();
      this.waitingForNext = false;
    }
    playlist.play();
    this.handlers.onPlaying();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.session?.abort();
    this.session = null;
    if (!this.startSettled) this.rejectStart(new Error('播放已停止。'));
    const playlist = this.playlist;
    this.playlist = null;
    if (playlist) {
      playlist.clearLockScreenControls();
      playlist.destroy();
    }
    for (const uri of this.files.values()) this.deleteFile(uri);
    this.files.clear();
  }

  private enqueueNetworkAudio(pcm: Uint8Array): void {
    if (this.stopped || this.failed || this.inputFinished) return;
    this.audioBytes += pcm.byteLength;
    if (this.audioBytes > MAX_STREAM_AUDIO_BYTES) {
      this.fail(new Error('流式音频超过 64 MiB 安全上限。'));
      return;
    }
    this.audioChunks.push(pcm);
    this.enqueuePcm(pcm);
  }

  private enqueuePcm(pcm: Uint8Array): void {
    for (const chunk of this.chunker.push(pcm)) {
      this.writeQueue = this.writeQueue.then(() => this.writeWavChunk(chunk));
      void this.writeQueue.catch((cause) => {
        this.fail(cause instanceof Error ? cause : new Error('PCM 缓冲写入失败。'));
      });
    }
  }

  private async writeWavChunk(chunk: Uint8Array): Promise<void> {
    if (this.stopped || this.failed) return;
    const file = new File(Paths.cache, `dsh-pcm-${Date.now()}-${++this.fileSequence}.wav`);
    try {
      await file.write(wrapPcmInWav(chunk, VOLC_TTS_STREAM_SAMPLE_RATE));
      if (this.stopped || this.failed) {
        if (file.exists) file.delete();
        return;
      }
      this.enqueueFile(file.uri);
    } catch (cause) {
      if (file.exists) file.delete();
      throw cause;
    }
  }

  private enqueueFile(uri: string): void {
    if (this.stopped || this.failed) return;
    const existing = this.playlist;
    if (!existing) {
      this.startPlaylist(uri);
      return;
    }
    const index = this.queuedCount;
    this.queuedCount += 1;
    this.files.set(index, uri);
    existing.add({ uri });
    if (this.waitingForNext && !this.paused) {
      existing.next();
      existing.play();
      this.waitingForNext = false;
    }
  }

  private startPlaylist(uri: string): void {
    if (this.stopped || this.failed) return;
    const playlist = createAudioPlaylist({ sources: [{ uri }], loop: 'none', updateInterval: 250 });
    this.playlist = playlist;
    this.files.set(0, uri);
    this.queuedCount = 1;
    playlist.playbackRate = this.rate;
    playlist.addListener('trackChanged', ({ previousIndex }) => {
      this.deleteTrackedFile(previousIndex);
    });
    playlist.addListener('playlistStatusUpdate', (status) => {
      if (this.playlist !== playlist || this.stopped || this.failed) return;
      const error = (status as typeof status & { error?: unknown }).error;
      if (error) {
        this.fail(new Error(typeof error === 'string' ? error : '原生播放队列失败。'));
        return;
      }
      if (status.didJustFinish) {
        if (this.inputFinished && status.currentIndex >= this.queuedCount - 1) {
          void this.stop();
          this.handlers.onFinished();
        } else {
          this.waitingForNext = true;
        }
        return;
      }
      if (status.playing && this.paused) {
        this.paused = false;
        this.handlers.onPlaying();
      } else if (!status.playing && !status.isBuffering && this.started && !this.paused) {
        this.paused = true;
        this.handlers.onPaused();
      }
    });
    playlist.setActiveForLockScreen(true, {
      title: 'DSH Connect 回复朗读',
      artist: 'DSH Connect',
    }, {
      showNextTrack: false,
      showPreviousTrack: false,
      showSeekBackward: false,
      showSeekForward: false,
    });
    playlist.play();
    this.started = true;
    this.paused = false;
    this.resolveStart();
    this.handlers.onPlaying();
  }

  private async finishInput(): Promise<void> {
    if (this.stopped || this.failed || this.inputFinished) return;
    try {
      this.inputFinished = true;
      this.chunker.flush();
      await this.writeQueue;
      if (this.stopped || this.failed) return;
      this.publishCompleteAudio();
      if (!this.playlist || this.queuedCount === 0) {
        this.fail(new Error('音频输入完成，但没有可播放内容。'));
      }
    } catch (cause) {
      this.fail(cause instanceof Error ? cause : new Error('PCM 音频流结束处理失败。'));
    }
  }

  private publishCompleteAudio(): void {
    if (this.fromCache || this.audioBytes === 0) return;
    const audio = new Uint8Array(this.audioBytes);
    let offset = 0;
    for (const chunk of this.audioChunks) {
      audio.set(chunk, offset);
      offset += chunk.byteLength;
    }
    void publishVolcPcm(this.options, audio).catch(() => undefined);
  }

  private fail(cause: Error): void {
    if (this.stopped || this.failed) return;
    this.failed = true;
    this.session?.abort();
    if (this.startSettled) this.handlers.onError(cause);
    else this.rejectStart(cause);
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

  private deleteTrackedFile(index: number): void {
    const uri = this.files.get(index);
    if (!uri) return;
    this.files.delete(index);
    this.deleteFile(uri);
  }

  private deleteFile(uri: string | null): void {
    if (!uri) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  }
}

type PlayerHandlers = {
  onPlaying: () => void;
  onPaused: () => void;
  onFinished: () => void;
  onError: (cause: Error) => void;
};
