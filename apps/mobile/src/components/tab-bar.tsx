import { Image } from 'expo-image';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/hooks/use-app-theme';
import {
  AppNavigation,
  type AppNavigationTab,
  type AppNavigationVariant,
} from '@shared/components/app-navigation';

export type HomeTab = AppNavigationTab;

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
  variant = 'bottom',
}: {
  active: HomeTab;
  onChange: (tab: HomeTab) => void;
  badge?: number;
  variant?: AppNavigationVariant;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  // The 48pt tab row already keeps iOS labels clear of the home indicator.
  const bottomInset = Platform.OS === 'ios' ? Math.min(insets.bottom, 12) : insets.bottom;

  return (
    <AppNavigation
      active={active}
      badge={badge}
      variant={variant}
      bottomPadding={Math.max(bottomInset, 6)}
      onChange={onChange}
      colors={{
        background: theme.background,
        border: theme.border,
        accent: theme.accent,
        accentSoft: theme.accentSoft,
        textSecondary: theme.textSecondary,
        onAccent: theme.onAccent,
        warning: theme.warning,
      }}
      items={TABS.map((tab) => ({
        ...tab,
        icon: (color: string) => <Image source={tab.icon} tintColor={color} contentFit="contain" style={styles.icon} />,
      }))}
    />
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 22,
    height: 22,
  },
});
