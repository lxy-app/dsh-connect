import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export type HomeTab = 'sessions' | 'interactions' | 'devices' | 'profile';

const TABS: { key: HomeTab; label: string }[] = [
  { key: 'sessions', label: '会话' },
  { key: 'interactions', label: '待处理' },
  { key: 'devices', label: '设备' },
  { key: 'profile', label: '我的' },
];

export function TabBar({
  active,
  onChange,
  badge,
}: {
  active: HomeTab;
  onChange: (tab: HomeTab) => void;
  badge?: number;
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.bar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <View
              style={[
                styles.indicator,
                { backgroundColor: selected ? theme.accent : 'transparent' },
              ]}
            />
            <Text
              style={[
                styles.label,
                { color: selected ? theme.accent : theme.textSecondary },
                selected && styles.labelActive,
              ]}
            >
              {tab.label}
            </Text>
            {tab.key === 'interactions' && badge ? (
              <View style={[styles.badge, { backgroundColor: theme.warning }]}>
                <Text style={[styles.badgeText, { color: theme.onAccent }]}>{badge}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  indicator: {
    width: 18,
    height: 3,
    borderRadius: 2,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  labelActive: {
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    top: 5,
    right: '28%',
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.55,
  },
});
