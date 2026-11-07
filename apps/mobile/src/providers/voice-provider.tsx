import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { PLAYBACK_AUDIO_MODE } from '@/lib/audio-session';
import type { VolcAsrProtocol } from '@/lib/volc-asr';
import {
  synthesizeVolcTts,
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
  const audioFileRef = useRef<File | null>(null);
  const synthesisControllerRef = useRef<AbortController | null>(null);
  const playbackGeneration = useRef(0);

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
      player.clearLockScreenControls();
      player.remove();
    }
    if (audioFileRef.current?.exists) audioFileRef.current.delete();
    audioFileRef.current = null;
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
    if (!current || current.status === 'paused') return;
    if (current.status === 'preparing') {
      await stopSpeaking();
      return;
    }
    const waitForRecording = options?.forRecording
      && Platform.OS === 'ios'
      && current.provider === 'volcengine'
      && current.status === 'playing';
    const generation = playbackGeneration.current;
    if (current.provider === 'system') {
      // expo-speech has no pause/resume implementation on Android.
      if (Platform.OS === 'android') {
        await stopSpeaking();
        return;
      }
      await Speech.pause();
    } else {
      playerRef.current?.pause();
    }
    changePlaybackStatus(generation, 'paused');
    if (waitForRecording) {
      // expo-audio SDK 58 schedules iOS deactivation 100 ms after pause. Its
      // AudioStream is not in the module registry, so let that task finish before
      // ASR activates the shared AVAudioSession for recording.
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
    }
  }, [changePlaybackStatus, stopSpeaking]);

  const resumeSpeaking = useCallback(async () => {
    const current = playbackRef.current;
    if (!current || current.status !== 'paused') return;
    const generation = playbackGeneration.current;
    const player = playerRef.current;
    await setAudioModeAsync(PLAYBACK_AUDIO_MODE);
    if (generation !== playbackGeneration.current || playbackRef.current !== current) return;
    if (current.provider === 'system') {
      if (Platform.OS === 'android') return;
      await Speech.resume();
    } else {
      if (!player) {
        await stopSpeaking();
        return;
      }
      player.play();
    }
    changePlaybackStatus(generation, 'playing');
  }, [changePlaybackStatus, stopSpeaking]);

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
        await setAudioModeAsync(PLAYBACK_AUDIO_MODE);
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

    const controller = new AbortController();
    synthesisControllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let file: File | null = null;
    const discardFile = () => {
      if (file?.exists) file.delete();
      if (file && audioFileRef.current === file) audioFileRef.current = null;
    };
    try {
      const audio = await synthesizeVolcTts({
        apiKey: config.apiKey,
        text: content,
        speaker: config.voice,
        endpoint: config.endpoint,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (generation !== playbackGeneration.current) return;

      file = new File(Paths.cache, `dsh-voice-${Date.now()}-${generation}.mp3`);
      await file.write(audio);
      if (generation !== playbackGeneration.current) {
        discardFile();
        return;
      }
      audioFileRef.current = file;

      await setAudioModeAsync(PLAYBACK_AUDIO_MODE);
      if (generation !== playbackGeneration.current) {
        discardFile();
        return;
      }

      const player = createAudioPlayer(file.uri);
      playerRef.current = player;
      player.setPlaybackRate(config.rate);
      player.addListener('playbackStatusUpdate', (status) => {
        if (generation !== playbackGeneration.current || playerRef.current !== player) return;
        if (status.didJustFinish || status.error) {
          player.clearLockScreenControls();
          player.remove();
          playerRef.current = null;
          discardFile();
          settle();
          return;
        }
        // Lock-screen and headphone/interruption changes arrive through the same
        // status event as in-app controls, so the message icon stays truthful.
        const nextStatus = voicePlaybackStatusFromAudio(status, playbackRef.current?.status ?? null);
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
    } catch (cause) {
      // Stop/new playback advances the generation before aborting the request.
      // A timeout keeps the same generation and must still surface an error.
      const timedOut = controller.signal.aborted;
      if (generation !== playbackGeneration.current) {
        discardFile();
        return;
      }
      settle();
      releasePlayback();
      discardFile();
      if (timedOut) throw new Error('语音合成超时，请检查网络后重试。');
      throw cause;
    } finally {
      clearTimeout(timeout);
      if (synthesisControllerRef.current === controller) synthesisControllerRef.current = null;
    }
  }, [changePlaybackStatus, markPlayback, releasePlayback, settings]);

  return (
    <VoiceContext.Provider value={{
      settings,
      hydrated,
      updateSettings,
      speak,
      pauseSpeaking,
      resumeSpeaking,
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
