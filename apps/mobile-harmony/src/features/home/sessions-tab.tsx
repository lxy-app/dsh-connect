import { useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatRelative } from '@shared/lib/format';
import type { MobileAccessWarning, MobileSession } from '@shared/types/mobile';

type StatusFilter = 'all' | 'running' | 'idle';

export type WorkspaceFilter = {
  deviceId: string;
  workspaceId: string;
  label: string;
};

export function SessionsTab({
  sessions,
  warnings,
  workspaceCount,
  workspaceFilter,
  onClearFilter,
  onOpenSession,
  onRequestAccess,
  refreshing,
  onRefresh,
  loading,
}: {
  sessions: MobileSession[];
  warnings: MobileAccessWarning[];
  workspaceCount: number;
  workspaceFilter: WorkspaceFilter | null;
  onClearFilter: () => void;
  onOpenSession: (session: MobileSession) => void;
  onRequestAccess: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  loading: boolean;
}) {
  const theme = useAppTheme();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sessions.filter((session) => {
      if (workspaceFilter && session.workspaceId !== workspaceFilter.workspaceId) return false;
      if (filter !== 'all' && session.status !== filter) return false;
      if (!needle) return true;
      return (
        session.title.toLowerCase().includes(needle) ||
        session.workspaceName.toLowerCase().includes(needle) ||
        session.deviceName.toLowerCase().includes(needle)
      );
    });
  }, [filter, query, sessions, workspaceFilter]);

  const running = sessions.filter((session) => session.status === 'running').length;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>会话</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {workspaceCount === 0
              ? '还没有获得桌面授权'
              : `${sessions.length} 个会话${running > 0 ? ` · ${running} 个运行中` : ''}`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="刷新会话"
          onPress={onRefresh}
          style={({ pressed }) => [
            styles.refresh,
            { borderColor: theme.border, backgroundColor: theme.surface },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.refreshText, { color: theme.accent }]}>刷新</Text>
        </Pressable>
      </View>

      {workspaceCount === 0 ? (
        <EmptyState
          title="先获得桌面访问授权"
          description="手机配对只证明设备身份。请向桌面 Connector 申请工作区访问，批准后即可在这里查看会话。"
          actionLabel="申请访问授权"
          onAction={onRequestAccess}
          secondary="授权由桌面用户确认，Server 不会替你做决定。"
        />
      ) : (
        <>
          <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.searchIcon, { color: theme.textSecondary }]}>⌕</Text>
            <TextInput
              accessibilityLabel="搜索会话"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="搜索标题、工作区或桌面"
              placeholderTextColor={theme.textSecondary}
              value={query}
              onChangeText={setQuery}
              style={[styles.searchInput, { color: theme.text }]}
            />
          </View>

          <View style={styles.chips}>
            {(
              [
                ['all', '全部'],
                ['running', '运行中'],
                ['idle', '空闲'],
              ] as const
            ).map(([key, label]) => {
              const selected = filter === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setFilter(key)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? theme.accent : theme.surface,
                      borderColor: selected ? theme.accent : theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: selected ? theme.onAccent : theme.textSecondary },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            {workspaceFilter ? (
              <Pressable
                accessibilityRole="button"
                onPress={onClearFilter}
                style={[styles.chip, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}
              >
                <Text style={[styles.chipText, { color: theme.accent }]}>
                  {workspaceFilter.label} ×
                </Text>
              </Pressable>
            ) : null}
          </View>

          {warnings.length > 0 ? (
            <View
              style={[styles.warning, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}
            >
              <Text style={[styles.warningTitle, { color: theme.warning }]}>部分桌面暂不可用</Text>
              {warnings.map((warning) => (
                <Text
                  key={`${warning.deviceId}-${warning.code}`}
                  style={[styles.warningText, { color: theme.warning }]}
                >
                  {warning.deviceName}：{warning.code === 'device_offline' ? '桌面离线' : warning.message}
                </Text>
              ))}
            </View>
          ) : null}

          {loading && sessions.length === 0 ? (
            <Text style={[styles.loading, { color: theme.textSecondary }]}>正在读取会话…</Text>
          ) : visible.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>没有匹配的会话</Text>
              <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>
                {query || filter !== 'all' || workspaceFilter
                  ? '试试清除筛选条件。'
                  : '桌面上的新会话会出现在这里。'}
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {visible.map((session) => (
                <SessionCard key={`${session.deviceId}-${session.sessionId}`} session={session} onPress={() => onOpenSession(session)} />
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function SessionCard({ session, onPress }: { session: MobileSession; onPress: () => void }) {
  const theme = useAppTheme();
  const running = session.status === 'running';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.cardTop}>
        <Text numberOfLines={2} style={[styles.cardTitle, { color: theme.text }]}>
          {session.title}
        </Text>
        <StatusBadge
          label={running ? '运行中' : '空闲'}
          tone={running ? 'accent' : 'neutral'}
        />
      </View>
      <View style={styles.cardMeta}>
        <Text numberOfLines={1} style={[styles.cardWorkspace, { color: theme.accent }]}>
          {session.workspaceName}
        </Text>
        <Text numberOfLines={1} style={[styles.cardDevice, { color: theme.textSecondary }]}>
          {session.deviceName}
        </Text>
        <Text style={[styles.cardTime, { color: theme.textSecondary }]}>
          {formatRelative(session.updatedAt)}
        </Text>
      </View>
    </Pressable>
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 3,
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
  refresh: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 8,
    marginTop: 4,
  },
  refreshText: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '600',
  },
  search: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  searchIcon: {
    fontSize: 17,
    lineHeight: 20,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.reading,
    lineHeight: 24,
    paddingVertical: 10,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '600',
  },
  warning: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  warningTitle: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '700',
  },
  warningText: {
    fontSize: Typography.secondary,
    lineHeight: 20,
  },
  loading: {
    fontSize: Typography.body,
    lineHeight: 20,
    textAlign: 'center',
    paddingVertical: 24,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: Typography.reading,
    lineHeight: 22,
    fontWeight: '600',
  },
  emptyCopy: {
    fontSize: Typography.body,
    lineHeight: 21,
    textAlign: 'center',
  },
  list: {
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardTitle: {
    flex: 1,
    fontSize: Typography.reading,
    lineHeight: 22,
    fontWeight: '600',
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardWorkspace: {
    fontSize: Typography.caption,
    lineHeight: 18,
    fontWeight: '600',
    maxWidth: '35%',
  },
  cardDevice: {
    flex: 1,
    fontSize: Typography.caption,
    lineHeight: 18,
  },
  cardTime: {
    fontSize: Typography.caption,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.7,
  },
});
