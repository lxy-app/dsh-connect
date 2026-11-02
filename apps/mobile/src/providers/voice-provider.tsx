import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { VolcAsrProtocol } from '@/lib/volc-asr';
import {
  synthesizeVolcTts,
  VOLC_TTS_DEFAULT_ENDPOINT,
  VOLC_TTS_DEFAULT_VOICE,
  VOLC_TTS_RESOURCE_ID,
} from '@/lib/volc-tts';

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
  voice: string;
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
  stopSpeaking: () => Promise<void>;
  /** Key of the utterance playing right now, so its trigger can show a playing state and stop accepting taps. */
  speakingKey: string | null;
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
      voice: typeof parsed.voice === 'string' && parsed.voice.trim() && parsed.voice !== 'system'
        ? parsed.voice
        : DEFAULT_SETTINGS.voice,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const audioFileRef = useRef<File | null>(null);
  const playbackGeneration = useRef(0);
  // Mirrors speakingKey so a second tap on the same trigger is rejected before React re-renders.
  const speakingKeyRef = useRef<string | null>(null);

  const markSpeaking = useCallback((key: string | null) => {
    speakingKeyRef.current = key;
    setSpeakingKey(key);
  }, []);

  const releasePlayback = useCallback(() => {
    void Speech.stop();
    playerRef.current?.remove();
    playerRef.current = null;
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
    markSpeaking(null);
    releasePlayback();
    await Speech.stop();
  }, [markSpeaking, releasePlayback]);

  const speak = useCallback(async (text: string, options?: SpeakOptions) => {
    const config = options?.overrides ?? settings;
    const key = options?.key ?? null;
    const content = text.trim();
    if (!content) return;
    // Tapping the trigger that is already playing must not queue a second utterance.
    if (key !== null && speakingKeyRef.current === key) return;

    const generation = ++playbackGeneration.current;
    releasePlayback();
    markSpeaking(key);
    // Only the utterance that still owns the player may report "finished".
    const settle = () => {
      if (watchdog) clearTimeout(watchdog);
      if (generation === playbackGeneration.current) markSpeaking(null);
    };
    // A provider that never reports completion (silent-mode iOS, a decoder that
    // rejects the stream) must not leave the trigger disabled forever.
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    if (key !== null) {
      const budget = Math.max(30_000, (content.length * 400) / Math.max(config.rate, 0.5));
      watchdog = setTimeout(settle, budget);
    }

    if (config.ttsProvider === 'system') {
      Speech.speak(content, {
        language: config.language,
        rate: config.rate,
        onDone: settle,
        onStopped: settle,
        onError: settle,
      });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const audio = await synthesizeVolcTts({
        apiKey: config.apiKey,
        text: content,
        speaker: config.voice,
        endpoint: config.endpoint,
        signal: controller.signal,
      });
      if (generation !== playbackGeneration.current) return;

      const file = new File(Paths.cache, `dsh-voice-${Date.now()}-${generation}.mp3`);
      await file.write(audio);
      if (generation !== playbackGeneration.current) {
        if (file.exists) file.delete();
        return;
      }

      const player = createAudioPlayer(file.uri);
      playerRef.current = player;
      audioFileRef.current = file;
      player.setPlaybackRate(config.rate);
      player.addListener('playbackStatusUpdate', (status) => {
        if (!status.didJustFinish || playerRef.current !== player) return;
        player.remove();
        playerRef.current = null;
        if (file.exists) file.delete();
        if (audioFileRef.current === file) audioFileRef.current = null;
        settle();
      });
      player.play();
    } catch (cause) {
      settle();
      throw cause;
    } finally {
      clearTimeout(timeout);
    }
  }, [markSpeaking, releasePlayback, settings]);

  return <VoiceContext.Provider value={{ settings, hydrated, updateSettings, speak, stopSpeaking, speakingKey }}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceContextValue {
  const context = useContext(VoiceContext);
  if (!context) throw new Error('useVoice must be used inside VoiceProvider');
  return context;
}
