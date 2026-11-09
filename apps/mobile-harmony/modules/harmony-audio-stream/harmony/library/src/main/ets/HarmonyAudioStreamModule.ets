import {
  ExpoModule,
  ExpoModuleContext,
  ExpoModuleDefinition,
} from '@expo-harmony/expo-modules-core';
import { audio } from '@kit.AudioKit';
import { BusinessError } from '@kit.BasicServicesKit';

const SAMPLE_RATE: number = 16_000;
const CHANNELS: number = 1;

function errorMessage(cause: Object): string {
  try {
    const error = cause as BusinessError;
    if (typeof error.message === 'string' && error.message.length > 0) {
      return error.code === undefined ? error.message : `${error.message} (${error.code})`;
    }
    return String(cause);
  } catch (_) {
    return 'Unknown HarmonyOS audio capture error.';
  }
}

export class HarmonyAudioStreamModule extends ExpoModule {
  private capturer?: audio.AudioCapturer;
  private startedAt: number = 0;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(context: ExpoModuleContext) {
    super(context);
  }

  override definition(): ExpoModuleDefinition {
    return new ExpoModuleDefinition()
      .name('HarmonyAudioStream')
      .constant('platform', 'harmony')
      .constant('sampleRate', SAMPLE_RATE)
      .constant('channels', CHANNELS)
      .events(['onPcmData', 'onError', 'onStateChange'])
      .asyncFunction('start', async (): Promise<void> => this.enqueue(() => this.startInternal()))
      .asyncFunction('stop', async (): Promise<void> => this.enqueue(() => this.stopInternal()))
      .onBackground((): void => {
        this.enqueue(() => this.stopInternal()).catch((): void => {});
      })
      .onPrepareForReload(async (): Promise<void> => this.enqueue(() => this.stopInternal()))
      .onDestroy((): void => {
        this.enqueue(() => this.stopInternal()).catch((): void => {});
      });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.operationTail.catch((): void => {}).then(operation);
    this.operationTail = next.catch((): void => {});
    return next;
  }

  private async startInternal(): Promise<void> {
    await this.stopInternal();

    const options: audio.AudioCapturerOptions = {
      streamInfo: {
        samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000,
        channels: audio.AudioChannel.CHANNEL_1,
        sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
        encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW,
      },
      capturerInfo: {
        source: audio.SourceType.SOURCE_TYPE_VOICE_RECOGNITION,
        capturerFlags: 0,
      },
    };

    let capturer: audio.AudioCapturer;
    try {
      capturer = await audio.createAudioCapturer(options);
    } catch (cause) {
      throw new Error(`无法创建鸿蒙麦克风采集器：${errorMessage(cause as Object)}`);
    }

    this.capturer = capturer;
    capturer.on('readData', (buffer: ArrayBuffer): void => {
      if (this.capturer !== capturer) return;

      // AudioCapturer may reuse its input buffer after this callback returns.
      const copy = buffer.slice(0);
      this.sendEvent('onPcmData', {
        data: copy,
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        timestamp: (Date.now() - this.startedAt) / 1000,
      });
    });
    try {
      this.startedAt = Date.now();
      await capturer.start();
      this.sendEvent('onStateChange', { isStreaming: true });
    } catch (cause) {
      if (this.capturer === capturer) this.capturer = undefined;
      this.startedAt = 0;
      await this.release(capturer);
      this.sendEvent('onStateChange', { isStreaming: false });
      throw new Error(`无法启动鸿蒙麦克风采集：${errorMessage(cause as Object)}`);
    }
  }

  private async stopInternal(): Promise<void> {
    const capturer = this.capturer;
    const wasActive = capturer !== undefined || this.startedAt !== 0;
    this.capturer = undefined;
    this.startedAt = 0;
    if (capturer === undefined) return;

    let failure: Error | undefined = undefined;
    try {
      capturer.off('readData');
      if (capturer.state === audio.AudioState.STATE_RUNNING || capturer.state === audio.AudioState.STATE_PAUSED) {
        await capturer.stop();
      }
    } catch (cause) {
      failure = new Error(`停止鸿蒙麦克风采集失败：${errorMessage(cause as Object)}`);
    }

    try {
      await this.release(capturer);
    } catch (cause) {
      if (failure === undefined) failure = cause as Error;
    }

    if (wasActive) this.sendEvent('onStateChange', { isStreaming: false });
    if (failure !== undefined) throw new Error(failure.message);
  }

  private async release(capturer: audio.AudioCapturer): Promise<void> {
    try {
      capturer.off('readData');
    } catch (_) {}
    if (capturer.state === audio.AudioState.STATE_RELEASED) return;
    await capturer.release();
  }
}
