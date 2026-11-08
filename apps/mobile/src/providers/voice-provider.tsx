import { createAudioPlayer, setAudioModeAsync, type AudioMode, type AudioPlayer } from 'expo-audio';
import type { File } from 'expo-file-system';
import * as Speech from 'expo-speech';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform } from 'react-native';

import { PAUSED_AUDIO_MODE, PLAYBACK_AUDIO_MODE } from '@/lib/audio-session';
import { splitTextForSpeech } from '@/lib/speech-segments';
import type { VolcAsrProtocol } from '@/lib/volc-asr';
import { VolcPcmPlayer } from '@/lib/volc-pcm-player';
import {
  activateVolcTtsCacheScope,
  invalidateVolcTtsSegment,
  releaseVolcTtsCacheScope,
  resolveVolcTtsSegment,
} from '@/lib/volc-tts-cache';
import {
  VOLC_TTS_DEFAULT_ENDPOINT,
  VOLC_TTS_RESOURCE_ID,
} from '@/lib/volc-tts';
import {
  normalizeVolcTtsVoice,
  VOLC_TTS_DEFAULT_VOICE,
  type VolcTtsVoiceId,
} from '@/lib/volc-tts-voices';
import { voicePlaybackStatusFromAudio, type VoicePlayback, type VoicePlaybackStatus } from '@/lib/voice-playback';

export type { VoicePlayback, VoicePlaybackStatus } from '@/lib/voice-playback';

export type VoiceServiceProvider = 'system' | 'volcengine';
export type VoiceSettings = {
  enabled: boolean;
  language: 'zh-CN' | 'en-US';
  asrProvider: VoiceServiceProvider;
  asrProtocol: VolcAsrProtocol;
  ttsProvider: VoiceServiceProvider;
  endpoint: string;
  apiKey: string;
  asrModel: string;
  model: string;
  voice: VolcTtsVoiceId;
  rate: number;
  autoPlay: boolean;
};

const STORAGE_KEY = 'dsh-connect.voice-settings.v1';
const DEFAULT_SETTINGS: VoiceSettings = {
  enabled: true,
  language: 'zh-CN',
  asrProvider: 'volcengine',
  asrProtocol: 'ws-bidirectional',
  ttsProvider: 'volcengine',
  endpoint: VOLC_TTS_DEFAULT_ENDPOINT,
  apiKey: '',
  asrModel: 'volc.seedasr.sauc.duration',
  model: VOLC_TTS_RESOURCE_ID,
  voice: VOLC_TTS_DEFAULT_VOICE,
  rate: 1,
  autoPlay: false,
};

export type SpeakOptions = {
  /** Settings snapshot to speak with; defaults to the saved settings. */
  overrides?: VoiceSettings;
  /** Caller key (for example a message id) used to report playback state. */
  key?: string;
};

type VoiceContextValue = {
  settings: VoiceSettings;
  hydrated: boolean;
  updateSettings: (patch: Partial<VoiceSettings>) => Promise<void>;
  speak: (text: string, options?: SpeakOptions) => Promise<void>;
  pauseSpeaking: (options?: { forRecording?: boolean }) => Promise<void>;
  resumeSpeaking: () => Promise<void>;
  restorePlaybackAudioMode: () => Promise<void>;
  stopSpeaking: () => Promise<void>;
  playback: VoicePlayback | null;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

function provider(value: unknown, fallback: VoiceServiceProvider): VoiceServiceProvider {
  return value === 'system' || value === 'volcengine' ? value : fallback;
}

function restoreSettings(stored: string): VoiceSettings {
  try {
    const parsed = JSON.parse(stored) as Partial<VoiceSettings> & { provider?: string };
    const legacyProvider = provider(parsed.provider, 'system');
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      language: parsed.language === 'en-US' ? 'en-US' : 'zh-CN',
      asrProvider: provider(parsed.asrProvider, legacyProvider),
      asrProtocol: parsed.asrProtocol === 'ws-unidirectional' ? 'ws-unidirectional' : 'ws-bidirectional',
      ttsProvider: provider(parsed.ttsProvider, legacyProvider),
      endpoint: typeof parsed.endpoint === 'string' && parsed.endpoint.trim()
        ? parsed.endpoint
        : DEFAULT_SETTINGS.endpoint,
      asrModel: DEFAULT_SETTINGS.asrModel,
      model: DEFAULT_SETTINGS.model,
      voice: normalizeVolcTtsVoice(parsed.voice),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [playback, setPlayback] = useState<VoicePlayback | null>(null);
  const playbackRef = useRef<VoicePlayback | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const pcmPlayerRef = useRef<VolcPcmPlayer | null>(null);
  const synthesisControllerRef = useRef<AbortController | null>(null);
  const cacheScopeOwnerRef = useRef<number | null>(null);
  const playbackGeneration = useRef(0);
  const iosAudioReleaseUntilRef = useRef(0);
  const audioModeQueueRef = useRef<Promise<void>>(Promise.resolve());

  const markPlayback = useCallback((next: VoicePlayback | null) => {
    playbackRef.current = next;
    setPlayback(next);
  }, []);

  const changePlaybackStatus = useCallback((generation: number, status: VoicePlaybackStatus) => {
    if (generation !== playbackGeneration.current) return;
    const current = playbackRef.current;
    if (current) markPlayback({ ...current, status });
  }, [markPlayback]);

  const releasePlayback = useCallback(() => {
    synthesisControllerRef.current?.abort();
    synthesisControllerRef.current = null;
    const player = playerRef.current;
    playerRef.current = null;
    if (player) {
      if (Platform.OS === 'ios') iosAudioReleaseUntilRef.current = Date.now() + 150;
      player.clearLockScreenControls();
      player.remove();
    }
    const pcmPlayer = pcmPlayerRef.current;
    pcmPlayerRef.current = null;
    if (pcmPlayer) {
      if (Platform.OS === 'ios') iosAudioReleaseUntilRef.current = Date.now() + 150;
      void pcmPlayer.stop().catch(() => undefined);
    }
    releaseVolcTtsCacheScope(cacheScopeOwnerRef.current);
    cacheScopeOwnerRef.current = null;
  }, []);

  const applyAudioMode = useCallback((mode: Partial<AudioMode>) => {
    const next = audioModeQueueRef.current
      .catch(() => undefined)
      .then(() => setAudioModeAsync(mode));
    audioModeQueueRef.current = next;
    return next;
  }, []);

  const restorePlaybackAudioMode = useCallback(() => {
    return applyAudioMode(playbackRef.current?.status === 'paused' ? PAUSED_AUDIO_MODE : PLAYBACK_AUDIO_MODE);
  }, [applyAudioMode]);

  const waitForRecordingAudioSession = useCallback(async () => {
    // A lock-screen pause can enqueue PAUSED immediately before hold-to-talk.
    // Drain every mode write queued before ASR so RECORDING cannot be overwritten.
    for (;;) {
      const pending = audioModeQueueRef.current;
      await pending.catch(() => undefined);
      if (pending === audioModeQueueRef.current) break;
    }
    // expo-audio SDK 58 releases a removed iOS player after 100 ms. AudioStream
    // is not in that module's registry, so do not let the old release task land
    // after ASR has activated the shared AVAudioSession.
    const remaining = iosAudioReleaseUntilRef.current - Date.now();
    if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }, []);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(STORAGE_KEY).then((stored) => {
      if (!active) return;
      if (stored) setSettings(restoreSettings(stored));
      setHydrated(true);
    }).catch(() => {
      if (active) setHydrated(true);
    });
    return () => {
      active = false;
      playbackGeneration.current += 1;
      releasePlayback();
      void Speech.stop();
    };
  }, [releasePlayback]);

  const updateSettings = useCallback(async (patch: Partial<VoiceSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    // API keys stay in Keychain / Keystore and are never added to logs or route params.
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next));
  }, [settings]);

  const stopSpeaking = useCallback(async () => {
    playbackGeneration.current += 1;
    markPlayback(null);
    releasePlayback();
    await Speech.stop();
  }, [markPlayback, releasePlayback]);

  const pauseSpeaking = useCallback(async (options?: { forRecording?: boolean }) => {
    const current = playbackRef.current;
    if (!current || current.status === 'paused') {
      if (options?.forRecording) await waitForRecordingAudioSession();
      return;
    }
    if (current.status === 'preparing') {
      await stopSpeaking();
      if (options?.forRecording) await waitForRecordingAudioSession();
      return;
    }
    const generation = playbackGeneration.current;
    if (current.provider === 'system') {
      // expo-speech has no pause/resume implementation on Android.
      if (Platform.OS === 'android') {
        await stopSpeaking();
        if (options?.forRecording) await waitForRecordingAudioSession();
        return;
      }
      await Speech.pause();
      changePlaybackStatus(generation, 'paused');
    } else {
      const pcmPlayer = pcmPlayerRef.current;
      playerRef.current?.pause();
      // Publish paused before awaiting native work so a lock-screen resume sees
      // the real transition and cannot be overwritten when this promise returns.
      changePlaybackStatus(generation, 'paused');
      if (pcmPlayer) await pcmPlayer.pause();
      // keepAudioSessionActive covers segment gaps. Mixing while intentionally
      // paused releases Android's exclusive focus and lets iOS apps share audio,
      // without disabling the native lock-screen resume path.
      await applyAudioMode(PAUSED_AUDIO_MODE);
    }
    if (options?.forRecording) await waitForRecordingAudioSession();
  }, [applyAudioMode, changePlaybackStatus, stopSpeaking, waitForRecordingAudioSession]);

  const resumeSpeaking = useCallback(async () => {
    const current = playbackRef.current;
    if (!current || current.status !== 'paused') return;
    const generation = playbackGeneration.current;
    const player = playerRef.current;
    const pcmPlayer = pcmPlayerRef.current;
    await applyAudioMode(PLAYBACK_AUDIO_MODE);
    if (generation !== playbackGeneration.current || playbackRef.current !== current) return;
    if (current.provider === 'system') {
      if (Platform.OS === 'android') return;
      await Speech.resume();
    } else {
      if (pcmPlayer) {
        await pcmPlayer.resume();
      } else {
        if (!player) {
          await stopSpeaking();
          return;
        }
        player.play();
      }
    }
    changePlaybackStatus(generation, 'playing');
  }, [applyAudioMode, changePlaybackStatus, stopSpeaking]);

  const speak = useCallback(async (text: string, options?: SpeakOptions) => {
    const config = options?.overrides ?? settings;
    const key = options?.key ?? null;
    const content = text.trim();
    if (!content) return;
    // Automatic playback and a manual tap can race; never queue the same item twice.
    if (key !== null && playbackRef.current?.key === key) return;

    const generation = ++playbackGeneration.current;
    releasePlayback();
    void Speech.stop();
    markPlayback({
      key,
      status: 'preparing',
      provider: config.ttsProvider,
      canPause: config.ttsProvider === 'volcengine' || Platform.OS !== 'android',
    });
    const settle = () => {
      if (generation === playbackGeneration.current) markPlayback(null);
    };

    if (config.ttsProvider === 'system') {
      try {
        await applyAudioMode(PLAYBACK_AUDIO_MODE);
        if (generation !== playbackGeneration.current) return;
        Speech.speak(content, {
          language: config.language,
          rate: config.rate,
          onStart: () => changePlaybackStatus(generation, 'playing'),
          onPause: () => changePlaybackStatus(generation, 'paused'),
          onResume: () => changePlaybackStatus(generation, 'playing'),
          onDone: settle,
          onStopped: settle,
          onError: settle,
        });
      } catch (cause) {
        settle();
        throw cause;
      }
      return;
    }

    if (Platform.OS !== 'web') {
      cacheScopeOwnerRef.current = generation;
      activateVolcTtsCacheScope(generation, [{
        text: content,
        speaker: config.voice,
        endpoint: config.endpoint,
        format: 'pcm',
      }]);
      const pcmPlayer = new VolcPcmPlayer({
        apiKey: config.apiKey,
        text: content,
        speaker: config.voice,
        endpoint: config.endpoint,
      }, config.rate, {
        onPlaying: () => {
          changePlaybackStatus(generation, 'playing');
          void applyAudioMode(PLAYBACK_AUDIO_MODE).catch(() => undefined);
        },
        onPaused: () => {
          changePlaybackStatus(generation, 'paused');
          void applyAudioMode(PAUSED_AUDIO_MODE).catch(() => undefined);
        },
        onFinished: () => {
          if (generation !== playbackGeneration.current) return;
          releasePlayback();
          settle();
        },
        onError: (cause) => {
          if (generation !== playbackGeneration.current) return;
          releasePlayback();
          settle();
          Alert.alert('语音播报失败', cause.message);
        },
      });
      pcmPlayerRef.current = pcmPlayer;
      try {
        if (generation !== playbackGeneration.current) return;
        await pcmPlayer.start();
        return;
      } catch {
        // A failure before the first PCM buffer closes the player. Fall through
        // to the phase-2 HTTP file queue without ever replaying partial audio.
        if (generation !== playbackGeneration.current) return;
        pcmPlayerRef.current = null;
      }
    }

    const controller = new AbortController();
    synthesisControllerRef.current = controller;
    const segments = splitTextForSpeech(content);
    cacheScopeOwnerRef.current = generation;
    activateVolcTtsCacheScope(generation, segments.map((segment) => ({
      text: segment,
      speaker: config.voice,
      endpoint: config.endpoint,
    })));
    const files = new Map<number, File>();
    const preparing = new Set<number>();
    let currentSegment = 0;
    let loadedSegment = -1;
    let waitingSegment: number | null = null;

    const resolveSegment = async (index: number) => {
      const segment = segments[index];
      if (segment === undefined) throw new Error('语音分段不存在。');
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const result = await resolveVolcTtsSegment({
          apiKey: config.apiKey,
          text: segment,
          speaker: config.voice,
          endpoint: config.endpoint,
          signal: controller.signal,
        });
        return result.file;
      } finally {
        clearTimeout(timeout);
      }
    };
    const reportAsyncError = (cause: unknown) => {
      if (generation !== playbackGeneration.current) return;
      const timedOut = controller.signal.aborted;
      releasePlayback();
      settle();
      const message = timedOut
        ? '语音合成超时，请检查网络后重试。'
        : cause instanceof Error ? cause.message : '请稍后重试。';
      Alert.alert('语音播报失败', message);
    };
    async function prepareSegment(index: number): Promise<void> {
      if (index >= segments.length || files.has(index) || preparing.has(index)) return;
      if (generation !== playbackGeneration.current) return;
      preparing.add(index);
      try {
        const file = await resolveSegment(index);
        if (generation !== playbackGeneration.current) return;
        files.set(index, file);
        if (waitingSegment === index) playSegment(index);
      } catch (cause) {
        reportAsyncError(cause);
      } finally {
        preparing.delete(index);
      }
    }
    function playSegment(index: number): boolean {
      const file = files.get(index);
      const player = playerRef.current;
      if (!file || !player || generation !== playbackGeneration.current) return false;
      currentSegment = index;
      waitingSegment = null;
      if (loadedSegment !== index) {
        player.replace(file.uri);
        loadedSegment = index;
      }
      // A pause racing with a segment boundary must carry into the next segment.
      if (playbackRef.current?.status !== 'paused') {
        player.play();
        changePlaybackStatus(generation, 'playing');
      }
      void prepareSegment(index + 1);
      return true;
    }

    try {
      const firstFile = await resolveSegment(0);
      if (generation !== playbackGeneration.current) return;
      files.set(0, firstFile);

      await applyAudioMode(PLAYBACK_AUDIO_MODE);
      if (generation !== playbackGeneration.current) return;

      // Keep iOS/Android background audio alive even when the next segment is
      // still synthesizing; releasePlayback() drops the keeper on real teardown.
      const player = createAudioPlayer(firstFile.uri, { keepAudioSessionActive: true });
      playerRef.current = player;
      loadedSegment = 0;
      player.setPlaybackRate(config.rate);
      player.addListener('playbackStatusUpdate', (status) => {
        if (generation !== playbackGeneration.current || playerRef.current !== player) return;
        if (status.error) {
          const invalidText = segments[loadedSegment];
          if (invalidText) {
            files.delete(loadedSegment);
            invalidateVolcTtsSegment({
              text: invalidText,
              speaker: config.voice,
              endpoint: config.endpoint,
            });
          }
          reportAsyncError(new Error(status.error));
          return;
        }
        if (status.didJustFinish) {
          try {
            if (currentSegment >= segments.length - 1) {
              releasePlayback();
              settle();
              return;
            }
            const next = currentSegment + 1;
            if (!playSegment(next)) {
              waitingSegment = next;
              changePlaybackStatus(generation, 'preparing');
              void prepareSegment(next);
            }
          } catch (cause) {
            reportAsyncError(cause);
          }
          return;
        }
        // Lock-screen and headphone/interruption changes arrive through the same
        // status event as in-app controls, so the message icon stays truthful.
        const previousStatus = playbackRef.current?.status ?? null;
        const nextStatus = voicePlaybackStatusFromAudio(status, previousStatus);
        if (nextStatus === 'paused') void applyAudioMode(PAUSED_AUDIO_MODE).catch(() => undefined);
        if (nextStatus === 'playing' && previousStatus === 'paused') {
          void applyAudioMode(PLAYBACK_AUDIO_MODE).catch(() => undefined);
        }
        if (nextStatus) changePlaybackStatus(generation, nextStatus);
      });
      player.setActiveForLockScreen(true, {
        title: 'DSH Connect 回复朗读',
        artist: 'DSH Connect',
      }, {
        showNextTrack: false,
        showPreviousTrack: false,
        showSeekBackward: false,
        showSeekForward: false,
      });
      player.play();
      changePlaybackStatus(generation, 'playing');
      void prepareSegment(1);
    } catch (cause) {
      // Stop/new playback advances the generation before aborting the request.
      // A timeout keeps the same generation and must still surface an error.
      const timedOut = controller.signal.aborted;
      if (generation !== playbackGeneration.current) return;
      settle();
      releasePlayback();
      if (timedOut) throw new Error('语音合成超时，请检查网络后重试。');
      throw cause;
    }
  }, [applyAudioMode, changePlaybackStatus, markPlayback, releasePlayback, settings]);

  return (
    <VoiceContext.Provider value={{
      settings,
      hydrated,
      updateSettings,
      speak,
      pauseSpeaking,
      resumeSpeaking,
      restorePlaybackAudioMode,
      stopSpeaking,
      playback,
    }}>
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice(): VoiceContextValue {
  const context = useContext(VoiceContext);
  if (!context) throw new Error('useVoice must be used inside VoiceProvider');
  return context;
}
