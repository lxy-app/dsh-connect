import { Slot } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo } from 'react';

import { useAppTheme } from '@/hooks/use-app-theme';
import { InteractionsProvider } from '@/providers/interactions-provider';
import { MobileSessionProvider } from '@/providers/mobile-session-provider';
import { AppThemeProvider, useThemeSettings } from '@/providers/theme-provider';
import { VoiceProvider } from '@/providers/voice-provider';

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <RootContent />
    </AppThemeProvider>
  );
}

function RootContent() {
  const { colorScheme } = useThemeSettings();
  const theme = useAppTheme();
  const navigationTheme = useMemo(() => {
    const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.accent,
        background: theme.background,
        card: theme.surface,
        text: theme.text,
        border: theme.border,
        notification: theme.danger,
      },
    };
  }, [colorScheme, theme]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.background).catch(() => undefined);
  }, [theme.background]);

  return (
    <MobileSessionProvider>
      <VoiceProvider>
        <InteractionsProvider>
          <NavigationThemeProvider value={navigationTheme}>
            <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
            <Slot />
          </NavigationThemeProvider>
        </InteractionsProvider>
      </VoiceProvider>
    </MobileSessionProvider>
  );
}
