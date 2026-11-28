import { ExpoFunction, ExpoModule, ExpoModuleContext, ExpoModuleDefinition, ExpoValueTypes } from '@expo-harmony/expo-modules-core';
import { audio } from '@kit.AudioKit';
import { avSession } from '@kit.AVSessionKit';
import { wantAgent, WantAgent } from '@kit.AbilityKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { BusinessError } from '@kit.BasicServicesKit';

const SAMPLE_RATE: number = 24_000;
const MAX_QUEUE_BYTES: number = 512 * 1024;
const MAX_WRITE_BYTES: number = 64 * 1024 * 1024;
const BACKGROUND_PLAYBACK_MODE: string = 'audioPlayback';
const MEDIA_SESSION_TAG: string = 'DshConnectPcmTts';

class PcmChunk {
  data: Uint8Array;
  position: number;
  constructor(data: Uint8Array, position: number) {
    this.data = data;
    this.position = position;
  }
}

class FinishWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  constructor(resolve: () => void, reject: (error: Error) => void) {
    this.resolve = resolve;
    this.reject = reject;
  }
}

function message(cause: Object): string {
  const error = cause as BusinessError;
  return error.message || String(cause);
}

/** One long-lived AudioRenderer, not a playlist of independently decoded files. */
export class HarmonyPcmOutputModule extends ExpoModule {
  private renderer?: audio.AudioRenderer;
  private queue: PcmChunk[] = [];
  private queuedBytes: number = 0;
  private capacityWaiters: Array<() => void> = [];
  private finishWaiters: FinishWaiter[] = [];
  private operationTail: Promise<void> = Promise.resolve();
  private playbackStart?: Promise<void>;
  private draining?: Promise<void>;
  private playing: boolean = false;
  private paused: boolean = false;
  private finishing: boolean = false;
  private epoch: number = 0;
  private playbackRate: number = 1;
  private mediaSession?: avSession.AVSession;
  private inBackground: boolean = false;
  private backgroundRunning: boolean = false;
  private backgroundTaskTail: Promise<void> = Promise.resolve();

  constructor(context: ExpoModuleContext) { super(context); }

  override definition(): ExpoModuleDefinition {
    return new ExpoModuleDefinition()
      .name('HarmonyPcmOutput')
      .constant('sampleRate', SAMPLE_RATE)
      .constant('channels', 1)
      .events(['onStarted', 'onFinished', 'onError', 'onStateChange'])
      .asyncFunction('start', ExpoFunction.typed1(
        ExpoValueTypes.number(),
        async (rate: number): Promise<number> => this.enqueue(() => this.startInternal(rate)),
      ))
      .asyncFunction('write', ExpoFunction.typed1(
        ExpoValueTypes.arrayBuffer(),
        async (pcm: ArrayBuffer): Promise<void> => this.writeInternal(pcm),
      ))
      .asyncFunction('pause', async (): Promise<void> => this.enqueue(() => this.pauseInternal()))
      .asyncFunction('resume', async (): Promise<void> => this.enqueue(() => this.resumeInternal()))
      .asyncFunction('finish', async (): Promise<void> => this.finishInternal())
      .asyncFunction('stop', async (): Promise<void> => this.enqueue(() => this.stopInternal()))
      .onBackground((): void => {
        this.inBackground = true;
        this.enqueue(() => this.queueBackgroundTaskSync()).catch((cause: Object): void => this.reportBackgroundError(cause));
      })
      .onForeground((): void => {
        this.inBackground = false;
        this.enqueue(() => this.queueBackgroundTaskSync()).catch((): void => {});
      })
      .onPrepareForReload(async (): Promise<void> => this.enqueue(() => this.stopInternal()))
      .onDestroy((): void => { this.enqueue(() => this.stopInternal()).catch((): void => {}); });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationTail.catch((): void => {}).then(operation);
    this.operationTail = next.then((): void => {}, (): void => {});
    return next;
  }

  private async startInternal(rate: number): Promise<number> {
    await this.stopInternal();
    if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) throw new Error('PCM playback rate must be between 0.25 and 4.');
    const epoch = this.epoch;
    const options: audio.AudioRendererOptions = {
      streamInfo: {
        samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_24000,
        channels: audio.AudioChannel.CHANNEL_1,
        sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
        encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW,
      },
      rendererInfo: { usage: audio.StreamUsage.STREAM_USAGE_MEDIA, rendererFlags: 0 },
    };
    const renderer = await audio.createAudioRenderer(options);
    try { renderer.setSpeed(rate); } catch (cause) {
      await renderer.release();
      throw new Error(`Cannot set PCM playback speed: ${message(cause as Object)}`);
    }
    if (epoch !== this.epoch) { await renderer.release(); throw new Error('PCM output was stopped during start.'); }
    this.renderer = renderer;
    this.playbackRate = rate;
    renderer.on('writeData', (data: ArrayBuffer): audio.AudioDataCallbackResult => this.fill(data, renderer, epoch));
    try { await this.ensureMediaSession(); } catch (cause) {
      await this.stopInternal();
      throw new Error(message(cause as Object));
    }
    this.sendEvent('onStateChange', { epoch, state: 'idle' });
    return epoch;
  }

  private async writeInternal(pcm: ArrayBuffer): Promise<void> {
    await this.operationTail;
    const renderer = this.renderer;
    const epoch = this.epoch;
    if (!renderer || this.finishing) throw new Error('PCM output is not accepting audio.');
    if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0 || pcm.byteLength > MAX_WRITE_BYTES) {
      throw new Error('PCM must be nonempty, 16-bit aligned and at most 64 MiB per write.');
    }
    const source = new Uint8Array(pcm);
    let position = 0;
    while (position < source.byteLength) {
      if (epoch !== this.epoch || this.renderer !== renderer || this.finishing) throw new Error('PCM output was stopped.');
      const available = MAX_QUEUE_BYTES - this.queuedBytes;
      if (available < 2) {
        await new Promise<void>((resolve) => { this.capacityWaiters.push(resolve); });
        continue;
      }
      const count = Math.min(source.byteLength - position, available) & ~1;
      const copy = new Uint8Array(count);
      copy.set(source.subarray(position, position + count));
      this.queue.push(new PcmChunk(copy, 0));
      this.queuedBytes += count;
      position += count;
      if (!this.playing && !this.paused) await this.startPlayback(renderer, epoch);
    }
  }

  private async startPlayback(renderer: audio.AudioRenderer, epoch: number): Promise<void> {
    if (!this.playbackStart) {
      this.playbackStart = renderer.start().then(async (): Promise<void> => {
        if (epoch !== this.epoch || this.renderer !== renderer) return;
        this.playing = true;
        await this.updateMediaPlaybackState();
        await this.queueBackgroundTaskSync();
        if (epoch !== this.epoch || this.renderer !== renderer) return;
        this.sendEvent('onStarted', { epoch, sampleRate: SAMPLE_RATE, channels: 1 });
        this.sendEvent('onStateChange', { epoch, state: 'playing' });
      }).catch((cause: Object): void => {
        if (epoch === this.epoch) this.sendEvent('onError', { epoch, message: message(cause) });
        throw new Error(message(cause));
      });
    }
    await this.playbackStart;
  }

  private fill(buffer: ArrayBuffer, renderer: audio.AudioRenderer, epoch: number): audio.AudioDataCallbackResult {
    if (epoch !== this.epoch || this.renderer !== renderer) return audio.AudioDataCallbackResult.INVALID;
    if (this.finishing && this.queuedBytes === 0) {
      if (!this.paused) this.beginDrain(renderer, epoch);
      return audio.AudioDataCallbackResult.INVALID;
    }
    const output = new Uint8Array(buffer);
    let offset = 0;
    while (offset < output.byteLength && this.queue.length > 0) {
      const chunk = this.queue[0];
      if (chunk === undefined) break;
      const count = Math.min(output.byteLength - offset, chunk.data.byteLength - chunk.position);
      output.set(chunk.data.subarray(chunk.position, chunk.position + count), offset);
      chunk.position += count;
      offset += count;
      this.queuedBytes -= count;
      if (chunk.position === chunk.data.byteLength) this.queue.shift();
    }
    if (offset < output.byteLength) output.fill(0, offset); // Network starvation: silence, never replay stale samples.
    this.wakeWriters();
    if (this.finishing && this.queuedBytes === 0 && !this.paused) this.beginDrain(renderer, epoch);
    return audio.AudioDataCallbackResult.VALID;
  }

  private wakeWriters(): void {
    const waiters = this.capacityWaiters.splice(0);
    for (const wake of waiters) wake();
  }

  private beginDrain(renderer: audio.AudioRenderer, epoch: number): void {
    if (this.draining) return;
    this.sendEvent('onStateChange', { epoch, state: 'draining' });
    this.draining = Promise.resolve().then(async (): Promise<void> => {
      if (epoch !== this.epoch || this.renderer !== renderer) return;
      await renderer.drain();
      if (epoch !== this.epoch || this.renderer !== renderer) return;
      await this.enqueue(() => this.stopInternal(true));
      this.sendEvent('onFinished', { epoch });
    }).catch((cause: Object): void => {
      const failure = new Error(message(cause));
      this.settleFinish(failure);
      if (epoch === this.epoch) {
        this.sendEvent('onError', { epoch, message: failure.message });
        this.enqueue(() => this.stopInternal()).catch((): void => {});
      }
      throw new Error(message(cause));
    });
    this.draining.catch((): void => {});
  }

  private async finishInternal(): Promise<void> {
    await this.operationTail;
    const renderer = this.renderer;
    if (!renderer) throw new Error('PCM output has not been started.');
    const epoch = this.epoch;
    this.finishing = true;
    // A paused renderer must stay paused. Completion is reported after resume drains it.
    if (this.paused) return;
    if (!this.playing && this.queue.length === 0) {
      await this.enqueue(() => this.stopInternal(true));
      this.sendEvent('onFinished', { epoch });
      return;
    }
    if (this.queuedBytes === 0) this.beginDrain(renderer, this.epoch);
    await new Promise<void>((resolve, reject) => { this.finishWaiters.push(new FinishWaiter(resolve, reject)); });
  }

  private async pauseInternal(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer || this.paused) return;
    this.paused = true;
    if (this.playing) await renderer.pause();
    await this.updateMediaPlaybackState();
    await this.queueBackgroundTaskSync();
    this.sendEvent('onStateChange', { epoch: this.epoch, state: 'paused' });
  }

  private async resumeInternal(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer || !this.paused) return;
    this.paused = false;
    if (this.playing) await renderer.start();
    else if (this.queue.length > 0) await this.startPlayback(renderer, this.epoch);
    await this.updateMediaPlaybackState();
    await this.queueBackgroundTaskSync();
    this.sendEvent('onStateChange', { epoch: this.epoch, state: this.playing ? 'playing' : 'idle' });
    if (this.finishing && this.queuedBytes === 0) this.beginDrain(renderer, this.epoch);
  }

  private async ensureMediaSession(): Promise<void> {
    if (this.mediaSession) return;
    const session = await avSession.createAVSession(this.context.uiAbilityContext, MEDIA_SESSION_TAG, 'audio');
    this.mediaSession = session;
    try {
      await session.setAVMetadata({ assetId: MEDIA_SESSION_TAG, title: 'DSH Connect 回复朗读', artist: 'DSH Connect' });
      session.on('play', (): void => {
        this.enqueue(() => this.resumeInternal()).catch((cause: Object): void => this.reportBackgroundError(cause));
      });
      session.on('pause', (): void => {
        this.enqueue(() => this.pauseInternal()).catch((cause: Object): void => this.reportBackgroundError(cause));
      });
      await session.activate();
    } catch (cause) {
      this.mediaSession = undefined;
      try { await session.destroy(); } catch (_) {}
      throw new Error(`无法建立朗读媒体会话：${message(cause as Object)}`);
    }
  }

  private async updateMediaPlaybackState(): Promise<void> {
    const session = this.mediaSession;
    if (!session) return;
    await session.setAVPlaybackState({
      state: this.playing && !this.paused ? avSession.PlaybackState.PLAYBACK_STATE_PLAY : avSession.PlaybackState.PLAYBACK_STATE_PAUSE,
      speed: this.playbackRate,
    });
  }

  private queueBackgroundTaskSync(): Promise<void> {
    const next = this.backgroundTaskTail.catch((): void => {}).then(async (): Promise<void> => this.syncBackgroundTask());
    this.backgroundTaskTail = next.catch((): void => {});
    return next;
  }

  private async syncBackgroundTask(): Promise<void> {
    const needed = this.inBackground && this.playing && !this.paused && this.renderer !== undefined;
    if (needed === this.backgroundRunning) return;
    if (!needed) {
      await backgroundTaskManager.stopBackgroundRunning(this.context.uiAbilityContext);
      this.backgroundRunning = false;
      return;
    }
    const ability = this.context.uiAbilityContext.abilityInfo;
    const agent: WantAgent = await wantAgent.getWantAgent({
      wants: [{ bundleName: ability.bundleName, abilityName: ability.name }],
      actionType: wantAgent.OperationType.START_ABILITY,
      requestCode: 0,
      actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
    });
    await backgroundTaskManager.startBackgroundRunning(this.context.uiAbilityContext, [BACKGROUND_PLAYBACK_MODE], agent);
    this.backgroundRunning = true;
  }

  private reportBackgroundError(cause: Object): void {
    if (this.renderer) this.sendEvent('onError', { epoch: this.epoch, message: `鸿蒙后台朗读保活失败：${message(cause)}` });
  }

  private async releaseMediaSession(): Promise<void> {
    const session = this.mediaSession;
    this.mediaSession = undefined;
    if (!session) return;
    try { await session.deactivate(); } catch (_) {}
    await session.destroy();
  }

  private settleFinish(cause?: Error): void {
    const waiters = this.finishWaiters.splice(0);
    for (const waiter of waiters) {
      if (cause) waiter.reject(cause);
      else waiter.resolve();
    }
  }

  private async stopInternal(completed: boolean = false): Promise<void> {
    const renderer = this.renderer;
    const endedEpoch = this.epoch;
    this.epoch += 1;
    this.renderer = undefined;
    this.playbackStart = undefined;
    this.draining = undefined;
    this.queue = [];
    this.queuedBytes = 0;
    this.playing = false;
    this.paused = false;
    this.finishing = false;
    this.wakeWriters();
    try {
      if (renderer) {
        try { renderer.off('writeData'); } catch (_) {}
        try { await renderer.stop(); } catch (_) {}
        await renderer.release();
      }
      await this.queueBackgroundTaskSync();
      await this.releaseMediaSession();
      this.settleFinish(completed ? undefined : new Error('PCM playback was stopped before finishing.'));
    } catch (cause) {
      this.settleFinish(new Error(message(cause as Object)));
      throw new Error(message(cause));
    } finally {
      this.sendEvent('onStateChange', { epoch: endedEpoch, state: 'idle' });
    }
  }
}
