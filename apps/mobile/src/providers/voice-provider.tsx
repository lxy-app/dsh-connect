import * as Speech from 'expo-speech';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type CloudTtsProvider = 'system' | 'volcengine' | 'aliyun' | 'tencent';
export type VoiceSettings = {
  enabled: boolean;
  language: 'zh-CN' | 'en-US';
  provider: CloudTtsProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  voice: string;
  rate: number;
  autoPlay: boolean;
};

const STORAGE_KEY = 'dsh-connect.voice-settings.v1';
const DEFAULT_SETTINGS: VoiceSettings = {
  enabled: true,
  language: 'zh-CN',
  provider: 'system',
  endpoint: '',
  apiKey: '',
  model: '',
  voice: 'system',
  rate: 1,
  autoPlay: false,
};

type VoiceContextValue = {
  settings: VoiceSettings;
  updateSettings: (patch: Partial<VoiceSettings>) => Promise<void>;
  speak: (text: string) => void;
  stopSpeaking: () => Promise<void>;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(STORAGE_KEY).then((stored) => {
      if (!stored || !active) return;
      try {
        const parsed = JSON.parse(stored) as Partial<VoiceSettings>;
        setSettings((current) => ({ ...current, ...parsed }));
      } catch {
        // Invalid local settings are ignored; safe defaults remain active.
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const updateSettings = useCallback(async (patch: Partial<VoiceSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    // The API key is kept only in Keychain / Keystore, never in logs or route params.
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next));
  }, [settings]);

  const speak = useCallback((text: string) => {
    const content = text.trim();
    if (!content) return;
    Speech.stop();
    // Cloud configuration is not represented as a successful connection. Until
    // a provider adapter is available, playback always uses the system engine.
    Speech.speak(content, { language: settings.language, rate: settings.rate });
  }, [settings.language, settings.rate]);

  const stopSpeaking = useCallback(async () => { await Speech.stop(); }, []);
  return <VoiceContext.Provider value={{ settings, updateSettings, speak, stopSpeaking }}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceContextValue {
  const context = useContext(VoiceContext);
  if (!context) throw new Error('useVoice must be used inside VoiceProvider');
  return context;
}
