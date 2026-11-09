import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ActionButton } from '@/components/action-button';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge, type BadgeTone } from '@/components/status-badge';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatScopes } from '@shared/lib/format';
import type { MobileDesktopAccess } from '@shared/types/mobile';

export function DevicesTab({
  desktops,
  onRequestAccess,
  onCancelRequest,
  onOpenSessions,
  onRevokeGrant,
  refreshing,
  onRefresh,
  busyGrantId,
}: {
  desktops: MobileDesktopAccess[];
  onRequestAccess: (deviceId: string) => void;
  onCancelRequest: (grantId: string) => void;
  onOpenSessions: (deviceId: string) => void;
  onRevokeGrant: (grantId: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  busyGrantId: string | null;
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
            ? '还没有桌面连接到 Server'
            : `${desktops.length} 台桌面 · ${desktops.filter((desktop) => desktop.online).length} 台在线`}
        </Text>
      </View>

      <View style={[styles.explain, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
        <Text style={[styles.explainTitle, { color: theme.text }]}>访问授权怎么完成？</Text>
        <Text style={[styles.explainStep, { color: theme.textSecondary }]}>1. 在手机上选择桌面与工作区并提交申请</Text>
        <Text style={[styles.explainStep, { color: theme.textSecondary }]}>2. 桌面 Connector 中由你本人确认授权范围</Text>
        <Text style={[styles.explainStep, { color: theme.textSecondary }]}>3. 回到手机刷新，授权的工作区即可查看与对话</Text>
      </View>

      {desktops.length === 0 ? (
        <EmptyState
          title="还没有可用的桌面"
          description="先在桌面 DSH 的 Connector 面板完成配对，并授权至少一个工作区。"
          secondary="手机配对不会自动获得桌面权限。"
        />
      ) : (
        desktops.map((desktop) => (
          <DesktopCard
            key={desktop.deviceId}
            desktop={desktop}
            onRequestAccess={onRequestAccess}
            onCancelRequest={onCancelRequest}
            onOpenSessions={onOpenSessions}
            onRevokeGrant={onRevokeGrant}
            busy={busyGrantId === desktop.grant?.grantId}
          />
        ))
      )}
    </ScrollView>
  );
}

function DesktopCard({
  desktop,
  onRequestAccess,
  onCancelRequest,
  onOpenSessions,
  onRevokeGrant,
  busy,
}: {
  desktop: MobileDesktopAccess;
  onRequestAccess: (deviceId: string) => void;
  onCancelRequest: (grantId: string) => void;
  onOpenSessions: (deviceId: string) => void;
  onRevokeGrant: (grantId: string) => void;
  busy: boolean;
}) {
  const theme = useAppTheme();
  const grant = desktop.grant;
  const state = accessState(grant?.status);
  const canRequest = desktop.availableWorkspaces.length > 0 && desktop.availableScopes.length > 0;

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
        <StatusBadge label={state.label} tone={state.tone} />
      </View>

      {grant && grant.status === 'active' ? (
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
      ) : (
        <Text style={[styles.scopeText, { color: theme.textSecondary }]}>
          桌面开放 {desktop.availableWorkspaces.length} 个工作区
          {grant?.status === 'pending' ? ' · 等待桌面用户确认' : ''}
        </Text>
      )}

      {grant?.status === 'pending' ? (
        <Text style={[styles.pendingHint, { color: theme.warning }]}>
          已提交申请。请到桌面 DSH 的 DSH Connect 面板完成确认，然后下拉刷新。
        </Text>
      ) : null}

      <View style={styles.actions}>
        {grant?.status === 'active' ? (
          <>
            <ActionButton
              label="查看会话"
              onPress={() => onOpenSessions(desktop.deviceId)}
              style={styles.action}
            />
            <ActionButton
              label={busy ? '处理中…' : '撤销授权'}
              loading={busy}
              onPress={() => onRevokeGrant(grant.grantId)}
              style={styles.action}
              variant="danger"
            />
          </>
        ) : grant?.status === 'pending' ? (
          <>
            <ActionButton
              label="等待桌面确认"
              onPress={() => undefined}
              disabled
              style={styles.action}
            />
            <ActionButton
              label={busy ? '处理中…' : '取消申请'}
              loading={busy}
              onPress={() => onCancelRequest(grant.grantId)}
              style={styles.action}
              variant="secondary"
            />
          </>
        ) : (
          <ActionButton
            label={canRequest ? '申请访问' : '桌面未开放工作区'}
            onPress={() => onRequestAccess(desktop.deviceId)}
            disabled={!canRequest}
          />
        )}
      </View>
    </View>
  );
}

function accessState(status?: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'active':
      return { label: '已授权', tone: 'success' };
    case 'pending':
      return { label: '等待桌面确认', tone: 'warning' };
    case 'denied':
      return { label: '已拒绝', tone: 'danger' };
    case 'revoked':
      return { label: '已撤销', tone: 'neutral' };
    default:
      return { label: '未授权', tone: 'neutral' };
  }
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
