import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar, type HomeTab } from '@/components/tab-bar';
import { useAppTheme } from '@/hooks/use-app-theme';
import { SessionMasterDetail } from '@shared/components/session-master-detail';
import { useResponsiveLayout } from '@shared/hooks/use-responsive-layout';

/** Places navigation and session master outside the detail's keyboard lifecycle. */
export function AdaptivePage({
  active,
  onChange,
  badge,
  master,
  children,
}: {
  active: HomeTab;
  onChange: (tab: HomeTab) => void;
  badge?: number;
  master?: ReactNode;
  children: ReactNode;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();

  return (
    <View style={[styles.page, { backgroundColor: theme.background }]}>
      <View
        key="navigation"
        style={{
          width: layout.navigationRailWidth,
          paddingTop: layout.isExpanded ? insets.top : 0,
          paddingBottom: layout.isExpanded ? insets.bottom : 0,
          backgroundColor: theme.background,
        }}
      >
        {layout.isExpanded ? <TabBar active={active} onChange={onChange} badge={badge} variant="rail" /> : null}
      </View>
      <SessionMasterDetail
        key="content"
        master={layout.isExpanded ? master : null}
        masterWidth={layout.sessionMasterWidth}
        borderColor={theme.border}
      >
        {children}
      </SessionMasterDetail>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    flexDirection: 'row',
  },
});
