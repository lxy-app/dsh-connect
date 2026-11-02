import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  secondary,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondary?: string;
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.mark, { backgroundColor: theme.accentSoft }]}>
        <Text style={[styles.markText, { color: theme.accent }]}>DSH</Text>
      </View>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.description, { color: theme.textSecondary }]}>{description}</Text>
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <ActionButton label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
      {secondary ? (
        <Text style={[styles.secondary, { color: theme.textSecondary }]}>{secondary}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingVertical: 30,
    alignItems: 'center',
    gap: 10,
  },
  mark: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: Typography.title,
    lineHeight: 24,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  description: {
    fontSize: Typography.body,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 320,
  },
  action: {
    alignSelf: 'stretch',
    marginTop: 8,
  },
  secondary: {
    fontSize: Typography.caption,
    lineHeight: 18,
    textAlign: 'center',
  },
});
