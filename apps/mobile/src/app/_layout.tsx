import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';
import { InteractionsProvider } from '@/providers/interactions-provider';
import { MobileSessionProvider } from '@/providers/mobile-session-provider';
import { VoiceProvider } from '@/providers/voice-provider';

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = useAppTheme();

  return (
    <MobileSessionProvider>
      <VoiceProvider>
      <InteractionsProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.background },
            }}
          />
        </ThemeProvider>
      </InteractionsProvider>
      </VoiceProvider>
    </MobileSessionProvider>
  );
}
