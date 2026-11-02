import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';

import {
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  resolveColorScheme,
  type AppColorScheme,
  type ThemePreference,
} from '@/lib/theme-preference';

const STORAGE_KEY = 'dsh-connect.theme-preference.v1';

type ThemeContextValue = {
  preference: ThemePreference;
  colorScheme: AppColorScheme;
  setPreference: (preference: ThemePreference) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const selectedBeforeHydration = useRef(false);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((stored) => {
        if (active && !selectedBeforeHydration.current) {
          setPreferenceState(parseThemePreference(stored));
        }
      })
      .catch(() => {
        // Keep following the system when the saved preference is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Keep native alerts, pickers and other system surfaces aligned with the app.
    Appearance.setColorScheme(preference === 'system' ? 'auto' : preference);
  }, [preference]);

  const setPreference = useCallback(async (next: ThemePreference) => {
    selectedBeforeHydration.current = true;
    setPreferenceState(next);
    await SecureStore.setItemAsync(STORAGE_KEY, next);
  }, []);

  const colorScheme = resolveColorScheme(preference, systemColorScheme);
  const value = useMemo(
    () => ({ preference, colorScheme, setPreference }),
    [colorScheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeSettings(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useThemeSettings must be used inside AppThemeProvider');
  return context;
}
