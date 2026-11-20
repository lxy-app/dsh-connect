import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ActionButton } from '@/components/action-button';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatScopes } from '@shared/lib/format';
import type { MobileDesktopAccess } from '@shared/types/mobile';

export function DevicesTab({
  desktops,
  onOpenSessions,
  refreshing,
  onRefresh,
}: {
  desktops: MobileDesktopAccess[];
  onOpenSessions: (deviceId: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const theme = useAppTheme();

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>设备</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {desktops.length === 0
            ? '当前账号没有可访问的桌面'
            : `${desktops.length} 台桌面 · ${desktops.filter((desktop) => desktop.online).length} 台在线`}
        </Text>
      </View>

      <View style={[styles.explain, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
        <Text style={[styles.explainTitle, { color: theme.text }]}>账号权限</Text>
        <Text style={[styles.explainStep, { color: theme.textSecondary }]}>桌面、工作区和操作权限由 Server 按用户访问策略统一下发。</Text>
        <Text style={[styles.explainStep, { color: theme.textSecondary }]}>如需调整权限，请联系管理员；策略更新后下拉刷新即可。</Text>
      </View>

      {desktops.length === 0 ? (
        <EmptyState
          title="没有可访问的桌面"
          description="当前账号访问策略没有可访问的桌面或工作区。"
          secondary="请联系管理员为账号配置访问策略。"
        />
      ) : (
        desktops.map((desktop) => (
          <DesktopCard
            key={desktop.deviceId}
            desktop={desktop}
            onOpenSessions={onOpenSessions}
          />
        ))
      )}
    </ScrollView>
  );
}

function DesktopCard({
  desktop,
  onOpenSessions,
}: {
  desktop: MobileDesktopAccess;
  onOpenSessions: (deviceId: string) => void;
}) {
  const theme = useAppTheme();
  const grant = desktop.grant;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.cardHead}>
        <View style={[styles.deviceIcon, { backgroundColor: theme.accentSoft }]}>
          <Text style={[styles.deviceIconText, { color: theme.accent }]}>PC</Text>
        </View>
        <View style={styles.cardTitleWrap}>
          <Text numberOfLines={1} style={[styles.cardTitle, { color: theme.text }]}>
            {desktop.deviceName}
          </Text>
          <Text style={[styles.cardMeta, { color: theme.textSecondary }]}>
            Connector {desktop.connectorVersion || '—'}
          </Text>
        </View>
        <StatusBadge
          label={desktop.online ? '在线' : '离线'}
          tone={desktop.online ? 'success' : 'neutral'}
        />
      </View>

      <View style={[styles.divider, { borderColor: theme.border }]} />

      <View style={styles.row}>
        <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>访问状态</Text>
        <StatusBadge label="账号已授权" tone="success" />
      </View>

      {grant ? (
        <View style={styles.granted}>
          {grant.workspaces.map((workspace) => (
            <View key={workspace.id} style={[styles.workspaceChip, { backgroundColor: theme.surfaceMuted }]}>
              <Text style={[styles.workspaceChipText, { color: theme.text }]}>{workspace.name}</Text>
            </View>
          ))}
          <Text style={[styles.scopeText, { color: theme.textSecondary }]}>
            动作：{formatScopes(grant.scopes) || '—'}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <ActionButton
          label="查看会话"
          onPress={() => onOpenSessions(desktop.deviceId)}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 14,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: Typography.body,
    lineHeight: 21,
  },
  explain: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 5,
  },
  explainTitle: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '700',
    marginBottom: 2,
  },
  explainStep: {
    fontSize: Typography.body,
    lineHeight: 21,
  },
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 11,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  deviceIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceIconText: {
    fontSize: Typography.caption,
    lineHeight: 18,
    fontWeight: '800',
  },
  cardTitleWrap: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: Typography.reading,
    lineHeight: 22,
    fontWeight: '600',
  },
  cardMeta: {
    fontSize: Typography.caption,
    lineHeight: 18,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowLabel: {
    fontSize: Typography.body,
    lineHeight: 20,
  },
  granted: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  workspaceChip: {
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  workspaceChipText: {
    fontSize: Typography.caption,
    lineHeight: 18,
    fontWeight: '600',
  },
  scopeText: {
    fontSize: Typography.secondary,
    lineHeight: 20,
  },
  pendingHint: {
    fontSize: Typography.secondary,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 9,
  },
  action: {
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
