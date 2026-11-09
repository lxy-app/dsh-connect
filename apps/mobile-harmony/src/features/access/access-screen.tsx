import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatScopes } from '@shared/lib/format';
import {
  describeMobileApiError,
  getMobileAccessOverview,
  requestMobileAccess,
  revokeMobileAccess,
} from '@/lib/mobile-api';
import { useMobileSession } from '@/providers/mobile-session-provider';
import type { MobileAccessOverview, MobileDesktopAccess } from '@shared/types/mobile';

type Selection = { workspaces: string[]; scopes: string[] };

export function AccessScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ deviceId?: string }>();
  const { authorized } = useMobileSession();
  const [overview, setOverview] = useState<MobileAccessOverview | null>(null);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [busyGrantId, setBusyGrantId] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const next = await authorized((serverUrl, token) => getMobileAccessOverview(serverUrl, token));
        setOverview(next);
        setSelections((current) => {
          const merged = { ...current };
          for (const desktop of next.desktops) {
            if (merged[desktop.deviceId]) continue;
            const availableScopes = desktop.availableScopes;
            // Re-requesting after a revoke restores the ordinary actions the
            // user already picked once. `approve` is never restored silently:
            // granting remote approvals always stays an explicit tap.
            const remembered = (desktop.grant?.scopes ?? []).filter(
              (scope) => scope !== 'approve' && availableScopes.includes(scope),
            );
            const rememberedWorkspaces = (desktop.grant?.workspaces ?? [])
              .map((workspace) => workspace.id)
              .filter((id) => desktop.availableWorkspaces.some((workspace) => workspace.id === id));
            merged[desktop.deviceId] = {
              workspaces: rememberedWorkspaces.length > 0
                ? rememberedWorkspaces
                : desktop.availableWorkspaces.map((workspace) => workspace.id),
              scopes: remembered.length > 0
                ? remembered
                : availableScopes.includes('read')
                  ? ['read']
                  : availableScopes.slice(0, 1),
            };
          }
          return merged;
        });
        setError(null);
      } catch (cause) {
        setError(describeMobileApiError(cause));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authorized],
  );

  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load]),
  );

  const desktops = useMemo(() => {
    const all = overview?.desktops ?? [];
    return params.deviceId ? all.filter((desktop) => desktop.deviceId === params.deviceId) : all;
  }, [overview, params.deviceId]);

  const toggleWorkspace = (deviceId: string, workspaceId: string) => {
    setSelections((current) => {
      const selection = current[deviceId];
      if (!selection) return current;
      return {
        ...current,
        [deviceId]: {
          ...selection,
          workspaces: selection.workspaces.includes(workspaceId)
            ? selection.workspaces.filter((id) => id !== workspaceId)
            : [...selection.workspaces, workspaceId],
        },
      };
    });
  };

  const toggleScope = (deviceId: string, scope: string) => {
    setSelections((current) => {
      const selection = current[deviceId];
      if (!selection) return current;
      return {
        ...current,
        [deviceId]: {
          ...selection,
          scopes: selection.scopes.includes(scope)
            ? selection.scopes.filter((item) => item !== scope)
            : [...selection.scopes, scope],
        },
      };
    });
  };

  const submit = (desktop: MobileDesktopAccess) => {
    const selection = selections[desktop.deviceId];
    if (!selection || selection.workspaces.length === 0) {
      Alert.alert('请选择工作区', '至少选择一个桌面开放的工作区。');
      return;
    }
    if (selection.scopes.length === 0) {
      Alert.alert('请选择动作', '至少选择一种允许的动作。');
      return;
    }
    setBusyDeviceId(desktop.deviceId);
    void authorized((serverUrl, token) =>
      requestMobileAccess(serverUrl, token, {
        deviceId: desktop.deviceId,
        workspaces: selection.workspaces,
        scopes: selection.scopes,
      }),
    )
      .then(() => {
        Alert.alert(
          '申请已提交',
          '请打开桌面 DSH 的 DSH Connect 面板，确认这台手机的访问范围。批准后回到 App 下拉刷新即可。',
          [{ text: '知道了', onPress: () => router.back() }],
        );
      })
      .catch((cause: unknown) => {
        Alert.alert('提交失败', describeMobileApiError(cause));
      })
      .finally(() => setBusyDeviceId(null));
  };

  const cancelRequest = (grantId: string) => {
    Alert.alert(
      '撤销并重新申请？',
      '已生效的授权不能就地扩权，补授「远程审批」只能撤销后重新申请。撤销后需重新提交申请并由桌面再次确认，期间的待处理审批也会一并失效。',
      [
        { text: '保留', style: 'cancel' },
        {
          text: '撤销',
          style: 'destructive',
          onPress: () => {
            setBusyGrantId(grantId);
            void authorized((serverUrl, token) => revokeMobileAccess(serverUrl, token, grantId))
              .then(() => load('refresh'))
              .catch((cause: unknown) => Alert.alert('撤销失败', describeMobileApiError(cause)))
              .finally(() => setBusyGrantId(null));
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.page, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={theme.accent} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.head}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={() => router.back()}
            hitSlop={10}
            style={({ pressed }) => [
              styles.back,
              { borderColor: theme.border, backgroundColor: theme.surface },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.backText, { color: theme.text }]}>‹</Text>
          </Pressable>
          <View style={styles.headText}>
            <Text style={[styles.title, { color: theme.text }]}>访问授权</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              选择桌面开放给你的工作区和动作，由桌面本人确认
            </Text>
          </View>
        </View>

        {error ? (
          <View style={[styles.error, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
            <Text style={[styles.errorText, { color: theme.warning }]}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load('refresh')}>
              <Text style={[styles.errorAction, { color: theme.warning }]}>重试</Text>
            </Pressable>
          </View>
        ) : null}

        {loading && !overview ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : desktops.length === 0 ? (
          <EmptyState
            title="没有可申请的桌面"
            description="先在桌面 DSH 的 Connector 面板完成配对并授权工作区，之后即可在这里提交手机访问申请。"
          />
        ) : (
          desktops.map((desktop) => (
            <DesktopAccessCard
              key={desktop.deviceId}
              desktop={desktop}
              selection={
                selections[desktop.deviceId] ?? {
                  workspaces: desktop.availableWorkspaces.map((workspace) => workspace.id),
                  scopes: desktop.availableScopes.includes('read') ? ['read'] : [],
                }
              }
              onToggleWorkspace={(workspaceId) => toggleWorkspace(desktop.deviceId, workspaceId)}
              onToggleScope={(scope) => toggleScope(desktop.deviceId, scope)}
              onSubmit={() => submit(desktop)}
              onCancelRequest={cancelRequest}
              submitting={busyDeviceId === desktop.deviceId}
              busyGrantId={busyGrantId}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function DesktopAccessCard({
  desktop,
  selection,
  onToggleWorkspace,
  onToggleScope,
  onSubmit,
  onCancelRequest,
  submitting,
  busyGrantId,
}: {
  desktop: MobileDesktopAccess;
  selection: Selection;
  onToggleWorkspace: (workspaceId: string) => void;
  onToggleScope: (scope: string) => void;
  onSubmit: () => void;
  onCancelRequest: (grantId: string) => void;
  submitting: boolean;
  busyGrantId: string | null;
}) {
  const theme = useAppTheme();
  const grant = desktop.grant;
  const active = grant?.status === 'active';
  const pending = grant?.status === 'pending';
  const [showPicker, setShowPicker] = useState(!active && !pending);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitles}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>{desktop.deviceName}</Text>
          <Text style={[styles.cardMeta, { color: theme.textSecondary }]}>
            {desktop.online ? '在线 · 可立即处理申请' : '离线 · 上线后可确认申请'}
          </Text>
        </View>
        <StatusBadge
          label={active ? '已授权' : pending ? '待确认' : '未授权'}
          tone={active ? 'success' : pending ? 'warning' : 'neutral'}
        />
      </View>

      {active ? (
        <>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>已授权范围</Text>
          <View style={styles.chips}>
            {grant.workspaces.map((workspace) => (
              <View key={workspace.id} style={[styles.chip, { backgroundColor: theme.accentSoft }]}>
                <Text style={[styles.chipText, { color: theme.accent }]}>{workspace.name}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.help, { color: theme.textSecondary }]}>
            动作：{formatScopes(grant.scopes) || '—'}。返回会话页即可查看这些工作区。
          </Text>
          {grant.scopes.includes('approve') ? null : (
            <Text style={[styles.help, { color: theme.warning }]}>
              未包含「远程审批」：桌面弹出的审批不会推送到这台手机。补授需要撤销后重新申请。
            </Text>
          )}
          <ActionButton
            label={busyGrantId === grant.grantId ? '处理中…' : '撤销并重新申请'}
            loading={busyGrantId === grant.grantId}
            onPress={() => onCancelRequest(grant.grantId)}
            variant="secondary"
          />
        </>
      ) : pending ? (
        <>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
            已提交申请（等待桌面确认）
          </Text>
          <View style={styles.chips}>
            {grant.workspaces.map((workspace) => (
              <View key={workspace.id} style={[styles.chip, { backgroundColor: theme.surfaceMuted }]}>
                <Text style={[styles.chipText, { color: theme.text }]}>{workspace.name}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.help, { color: theme.textSecondary }]}>
            动作：{formatScopes(grant.scopes) || '—'}。请在桌面 DSH 的 DSH Connect 面板确认。
          </Text>
          <ActionButton
            label={busyGrantId === grant.grantId ? '处理中…' : '取消申请'}
            loading={busyGrantId === grant.grantId}
            onPress={() => onCancelRequest(grant.grantId)}
            variant="secondary"
          />
        </>
      ) : (
        <>
          {!showPicker ? (
            <ActionButton label="重新选择范围" onPress={() => setShowPicker(true)} variant="secondary" />
          ) : (
            <>
              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>工作区</Text>
              {desktop.availableWorkspaces.length === 0 ? (
                <Text style={[styles.help, { color: theme.textSecondary }]}>
                  桌面当前没有开放任何工作区。
                </Text>
              ) : (
                <View style={styles.optionList}>
                  {desktop.availableWorkspaces.map((workspace) => {
                    const selected = selection.workspaces.includes(workspace.id);
                    return (
                      <Pressable
                        key={workspace.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        onPress={() => onToggleWorkspace(workspace.id)}
                        style={({ pressed }) => [
                          styles.option,
                          { borderColor: theme.border, backgroundColor: theme.surfaceMuted },
                          pressed && styles.pressed,
                        ]}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            {
                              borderColor: selected ? theme.accent : theme.border,
                              backgroundColor: selected ? theme.accent : 'transparent',
                            },
                          ]}
                        >
                          {selected ? (
                            <Text style={[styles.checkboxMark, { color: theme.onAccent }]}>✓</Text>
                          ) : null}
                        </View>
                        <Text style={[styles.optionText, { color: theme.text }]}>{workspace.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>允许的动作</Text>
              <View style={styles.optionList}>
                {desktop.availableScopes.map((scope) => {
                  const selected = selection.scopes.includes(scope);
                  return (
                    <Pressable
                      key={scope}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      onPress={() => onToggleScope(scope)}
                      style={({ pressed }) => [
                        styles.option,
                        { borderColor: theme.border, backgroundColor: theme.surfaceMuted },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: selected ? theme.accent : theme.border,
                            backgroundColor: selected ? theme.accent : 'transparent',
                          },
                        ]}
                      >
                        {selected ? (
                          <Text style={[styles.checkboxMark, { color: theme.onAccent }]}>✓</Text>
                        ) : null}
                      </View>
                      <View style={styles.optionTextWrap}>
                        <Text style={[styles.optionText, { color: theme.text }]}>{scopeLabel([scope])}</Text>
                        <Text style={[styles.optionHelp, { color: theme.textSecondary }]}>
                          {scopeHelp(scope)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {desktop.availableScopes.includes('approve') && !selection.scopes.includes('approve') ? (
                <Text style={[styles.help, { color: theme.warning }]}>
                  不勾选「远程审批」，桌面弹出审批时手机收不到任何副本；补授只能在撤销授权后重新申请。
                </Text>
              ) : null}

              {desktop.availableScopes.includes('approve') ? null : (
                <Text style={[styles.help, { color: theme.warning }]}>
                  桌面尚未开放“远程审批”。请先在桌面 DSH 的 DSH Connect 面板点击“启用远程审批”，再回到这里刷新并勾选。
                </Text>
              )}

              <ActionButton
                label={submitting ? '正在提交…' : '提交访问申请'}
                loading={submitting}
                onPress={onSubmit}
                disabled={desktop.availableWorkspaces.length === 0 || desktop.availableScopes.length === 0}
              />
              <Text style={[styles.help, { color: theme.textSecondary }]}>
                提交后仍需桌面 Connector 中由你本人确认。Server 只负责传递申请，不会自动批准。
              </Text>
            </>
          )}
        </>
      )}
    </View>
  );
}

function scopeLabel(scopes: string[]): string {
  const labels: Record<string, string> = { read: '查看会话', prompt: '发送提示词', approve: '远程审批', cancel: '取消执行' };
  return scopes.map((scope) => labels[scope] ?? scope).join(' · ') || '—';
}

function scopeHelp(scope: string): string {
  switch (scope) {
    case 'read':
      return '读取会话列表、标题与历史消息';
    case 'prompt':
      return '向会话发送补充指令，可能驱动 Agent 修改文件';
    case 'approve':
      return '在手机上批准一次性工具调用或回答 DSH 的提问；不勾选则桌面审批不会推送到手机';
    case 'cancel':
      return '停止会话当前正在执行的 Turn';
    default:
      return '';
  }
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 36,
    gap: 14,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  backText: {
    fontSize: 26,
    lineHeight: 28,
    marginTop: -3,
  },
  headText: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  errorText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  errorAction: {
    fontSize: 11,
    fontWeight: '700',
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 11,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardTitles: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
  },
  cardMeta: {
    fontSize: 11,
    lineHeight: 16,
  },
  sectionLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  help: {
    fontSize: 11,
    lineHeight: 17,
  },
  optionList: {
    gap: 7,
  },
  option: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMark: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '800',
  },
  optionText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  optionTextWrap: {
    flex: 1,
    gap: 1,
  },
  optionHelp: {
    fontSize: 10,
    lineHeight: 15,
  },
  pressed: {
    opacity: 0.7,
  },
});
