import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export function AppMark() {
  const theme = useAppTheme();

  return (
    <View
      accessibilityLabel="DSH Connect"
      style={[styles.mark, { backgroundColor: theme.accent }]}
    >
      <Text style={[styles.text, { color: theme.onAccent }]}>DS</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    width: 54,
    height: 54,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
});
