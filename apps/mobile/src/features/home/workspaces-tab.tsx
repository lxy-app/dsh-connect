import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatScopes } from '@/lib/format';
import type { MobileWorkspaceSummary } from '@/types/mobile';

export type WorkspaceEntry = MobileWorkspaceSummary & {
  deviceId: string;
  deviceName: string;
  online: boolean;
  scopes: string[];
};

export function WorkspacesTab({
  workspaces,
  onOpenWorkspace,
  onRequestAccess,
  refreshing,
  onRefresh,
}: {
  workspaces: WorkspaceEntry[];
  onOpenWorkspace: (workspace: WorkspaceEntry) => void;
  onRequestAccess: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const theme = useAppTheme();
  const devices = groupByDevice(workspaces);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>工作区</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {workspaces.length === 0
            ? '授权后，这里会列出桌面开放给你的工作区'
            : `${devices.length} 台桌面 · ${workspaces.length} 个工作区`}
        </Text>
      </View>

      {workspaces.length === 0 ? (
        <EmptyState
          title="还没有可访问的工作区"
          description="桌面 Connector 中批准这台手机后，属于你的工作区会出现在这里。"
          actionLabel="申请访问授权"
          onAction={onRequestAccess}
        />
      ) : (
        devices.map((group) => (
          <View key={group.deviceId} style={styles.group}>
            <View style={styles.groupHead}>
              <View style={styles.groupTitleRow}>
                <Text style={[styles.groupTitle, { color: theme.text }]}>{group.deviceName}</Text>
                <StatusBadge
                  label={group.online ? '在线' : '离线'}
                  tone={group.online ? 'success' : 'neutral'}
                />
              </View>
              <Text style={[styles.groupMeta, { color: theme.textSecondary }]}>
                {group.online ? 'Connector 已连接，可读取会话' : '桌面离线，仅能查看授权范围'}
              </Text>
            </View>
            {group.workspaces.map((workspace) => (
              <Pressable
                key={`${workspace.deviceId}-${workspace.id}`}
                accessibilityRole="button"
                onPress={() => onOpenWorkspace(workspace)}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.mark, { backgroundColor: theme.accentSoft }]}>
                    <Text style={[styles.markText, { color: theme.accent }]}>WS</Text>
                  </View>
                  <View style={styles.cardText}>
                    <Text numberOfLines={1} style={[styles.cardTitle, { color: theme.text }]}>
                      {workspace.name}
                    </Text>
                    <Text style={[styles.cardCopy, { color: theme.textSecondary }]}>
                      {formatScopes(workspace.scopes) || '仅查看'}
                    </Text>
                  </View>
                  <Text style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ))
      )}

      <View style={[styles.note, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
        <Text style={[styles.noteTitle, { color: theme.text }]}>授权边界</Text>
        <Text style={[styles.noteCopy, { color: theme.textSecondary }]}>
          手机只能看到被批准的工作区与动作；桌面取消授权或吊销手机后，访问会立即失效。会话正文仍然只保存在桌面 DSH。
        </Text>
      </View>
    </ScrollView>
  );
}

function groupByDevice(workspaces: WorkspaceEntry[]): {
  deviceId: string;
  deviceName: string;
  online: boolean;
  workspaces: WorkspaceEntry[];
}[] {
  const groups = new Map<
    string,
    { deviceId: string; deviceName: string; online: boolean; workspaces: WorkspaceEntry[] }
  >();
  for (const workspace of workspaces) {
    const existing = groups.get(workspace.deviceId);
    if (existing) {
      existing.workspaces.push(workspace);
      existing.online = existing.online || workspace.online;
    } else {
      groups.set(workspace.deviceId, {
        deviceId: workspace.deviceId,
        deviceName: workspace.deviceName,
        online: workspace.online,
        workspaces: [workspace],
      });
    }
  }
  return [...groups.values()];
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 18,
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
    fontSize: 13,
    lineHeight: 19,
  },
  group: {
    gap: 8,
  },
  groupHead: {
    gap: 3,
    paddingHorizontal: 2,
  },
  groupTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  groupMeta: {
    fontSize: 11,
    lineHeight: 16,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    fontSize: 11,
    fontWeight: '800',
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
  },
  cardCopy: {
    fontSize: 11,
    lineHeight: 16,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 24,
  },
  note: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    gap: 5,
  },
  noteTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  noteCopy: {
    fontSize: 11,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.7,
  },
});
