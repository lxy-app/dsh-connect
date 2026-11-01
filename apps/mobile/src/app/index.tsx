import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { HomeScreen } from '@/features/home/home-screen';
import { WelcomeScreen } from '@/features/onboarding/welcome-screen';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useMobileSession } from '@/providers/mobile-session-provider';

export default function IndexScreen() {
  const theme = useAppTheme();
  const { status, session } = useMobileSession();

  if (status === 'loading' && !session) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (status === 'paired' && session) {
    return <HomeScreen />;
  }

  return <WelcomeScreen />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
