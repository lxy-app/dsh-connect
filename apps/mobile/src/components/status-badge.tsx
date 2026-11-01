import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

export function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: BadgeTone;
}) {
  const theme = useAppTheme();
  const palette = {
    neutral: { background: theme.surfaceMuted, color: theme.textSecondary },
    success: { background: theme.accentSoft, color: theme.success },
    warning: { background: theme.warningSoft, color: theme.warning },
    danger: { background: theme.dangerSoft, color: theme.danger },
    accent: { background: theme.accentSoft, color: theme.accent },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.background }]}>
      <Text style={[styles.label, { color: palette.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
});
