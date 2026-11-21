import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type AppNavigationTab = 'sessions' | 'interactions' | 'devices' | 'profile';
export type AppNavigationVariant = 'bottom' | 'rail';

export type AppNavigationItem = {
  key: AppNavigationTab;
  label: string;
  icon: (color: string) => ReactNode;
};

export type AppNavigationColors = {
  background: string;
  border: string;
  accent: string;
  accentSoft: string;
  textSecondary: string;
  onAccent: string;
  warning: string;
};

/** Presentational navigation only; shells own icons, safe-area and routing. */
export function AppNavigation({
  active,
  items,
  onChange,
  badge = 0,
  variant = 'bottom',
  colors,
  bottomPadding = 6,
}: {
  active: AppNavigationTab;
  items: readonly AppNavigationItem[];
  onChange: (tab: AppNavigationTab) => void;
  badge?: number;
  variant?: AppNavigationVariant;
  colors: AppNavigationColors;
  bottomPadding?: number;
}) {
  const rail = variant === 'rail';
  return (
    <View
      style={[
        styles.bar,
        rail ? styles.railBar : styles.bottomBar,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
          paddingBottom: rail ? 12 : bottomPadding,
        },
      ]}
    >
      {items.map((tab) => {
        const selected = tab.key === active;
        const color = selected ? colors.accent : colors.textSecondary;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [
              styles.tab,
              rail ? styles.railTab : styles.bottomTab,
              rail && selected ? { backgroundColor: colors.accentSoft } : null,
              pressed && styles.pressed,
            ]}
          >
            {tab.icon(color)}
            <Text style={[styles.label, { color }, selected && styles.labelActive]}>{tab.label}</Text>
            {tab.key === 'interactions' && badge > 0 ? (
              <View style={[styles.badge, rail ? styles.railBadge : styles.bottomBadge, { backgroundColor: colors.warning }]}>
                <Text style={[styles.badgeText, { color: colors.onAccent }]}>{badge}</Text>
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
    paddingTop: 6,
  },
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  railBar: {
    flex: 1,
    flexDirection: 'column',
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingHorizontal: 8,
    paddingTop: 14,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  bottomTab: {
    flex: 1,
    minHeight: 48,
  },
  railTab: {
    width: '100%',
    minHeight: 60,
    borderRadius: 14,
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 3,
  },
  label: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  labelActive: {
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bottomBadge: {
    top: 2,
    right: '27%',
  },
  railBadge: {
    top: 6,
    right: 7,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.55,
  },
});
