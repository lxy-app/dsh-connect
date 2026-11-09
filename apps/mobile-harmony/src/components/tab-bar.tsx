import { Image } from 'expo-image';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';

export type HomeTab = 'sessions' | 'interactions' | 'devices' | 'profile';

const TABS: { key: HomeTab; label: string; icon: number }[] = [
  { key: 'sessions', label: '会话', icon: require('../../assets/tab-icons/sessions.png') },
  { key: 'interactions', label: '待处理', icon: require('../../assets/tab-icons/interactions.png') },
  { key: 'devices', label: '设备', icon: require('../../assets/tab-icons/devices.png') },
  { key: 'profile', label: '我的', icon: require('../../assets/tab-icons/profile.png') },
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
  const insets = useSafeAreaInsets();
  // The 48pt tab row already keeps iOS labels clear of the home indicator.
  const bottomInset = Platform.OS === 'ios' ? Math.min(insets.bottom, 12) : insets.bottom;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          paddingBottom: Math.max(bottomInset, 6),
        },
      ]}
    >
      {TABS.map((tab) => {
        const selected = tab.key === active;
        const color = selected ? theme.accent : theme.textSecondary;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Image source={tab.icon} tintColor={color} contentFit="contain" style={styles.icon} />
            <Text style={[styles.label, { color }, selected && styles.labelActive]}>
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
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  icon: {
    width: 22,
    height: 22,
  },
  label: {
    fontSize: Typography.caption,
    lineHeight: 18,
    fontWeight: '500',
  },
  labelActive: {
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: '27%',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontSize: Typography.caption,
    lineHeight: 16,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.55,
  },
});
