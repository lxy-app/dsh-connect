import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar, type HomeTab } from '@/components/tab-bar';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  describeMobileApiError,
  getMobileAccessOverview,
  getMobileSessions,
  revokeMobileAccess,
} from '@/lib/mobile-api';
import { InteractionsScreen } from '@/features/interactions/interactions-screen';
import { useInteractions } from '@/providers/interactions-provider';
import { useMobileSession } from '@/providers/mobile-session-provider';
import type {
  MobileAccessOverview,
  MobileSession,
  MobileSessionList,
} from '@shared/types/mobile';

import { DevicesTab } from './devices-tab';
import { ProfileTab } from './profile-tab';
import { SessionsTab, type WorkspaceFilter } from './sessions-tab';
import type { WorkspaceEntry } from './workspaces-tab';

export function HomeScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: HomeTab }>();
  const insets = useSafeAreaInsets();
  const { session, authorized, disconnect, lastSession, rememberSession } = useMobileSession();
  const { interactions } = useInteractions();
  const openInteractions = () => router.push('/interactions');
  const requestedTab = params.tab === 'interactions' || params.tab === 'devices' || params.tab === 'profile' ? params.tab : 'sessions';
  const tab = requestedTab;
  const setTab = (next: HomeTab) => router.setParams({ tab: next });
  const [overview, setOverview] = useState<MobileAccessOverview | null>(null);
  const [sessionList, setSessionList] = useState<MobileSessionList | null>(null);
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilter | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyGrantId, setBusyGrantId] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
      if (mode === 'refresh') setRefreshing(true);
      if (mode === 'initial') setLoading(true);
      try {
        const [nextOverview, nextSessions] = await Promise.all([
          authorized((serverUrl, token) => getMobileAccessOverview(serverUrl, token)),
          authorized((serverUrl, token) => getMobileSessions(serverUrl, token)),
        ]);
        setOverview(nextOverview);
        setSessionList(nextSessions);
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
      void load('silent');
    }, [load]),
  );

  const workspaces = useMemo<WorkspaceEntry[]>(() => {
    const result: WorkspaceEntry[] = [];
    for (const desktop of overview?.desktops ?? []) {
      if (desktop.grant?.status !== 'active') continue;
      for (const workspace of desktop.grant.workspaces) {
        result.push({
          ...workspace,
          deviceId: desktop.deviceId,
          deviceName: desktop.deviceName,
          online: desktop.online,
          scopes: desktop.grant.scopes,
        });
      }
    }
    return result;
  }, [overview]);


  const openRequestAccess = (deviceId?: string) => {
    router.push(deviceId ? { pathname: '/access', params: { deviceId } } : '/access');
  };

  const openSession = useCallback((sessionItem: MobileSession, replace = false) => {
    rememberSession(sessionItem);
    const route = {
      pathname: '/session/[sessionId]' as const,
      params: {
        sessionId: sessionItem.sessionId,
        deviceId: sessionItem.deviceId,
        workspaceId: sessionItem.workspaceId,
        title: sessionItem.title,
        deviceName: sessionItem.deviceName,
        workspaceName: sessionItem.workspaceName,
        scopes: JSON.stringify(sessionItem.scopes),
      },
    };
    if (replace) router.replace(route);
    else router.push(route);
  }, [rememberSession, router]);
  useEffect(() => {
    if (tab !== 'sessions' || loading || !sessionList?.sessions.length) return;
    const target = lastSession && sessionList.sessions.find((item) => item.sessionId === lastSession.sessionId && item.deviceId === lastSession.deviceId);
    openSession(target ?? sessionList.sessions[0], true);
  }, [lastSession, loading, openSession, sessionList, tab]);

  const revokeGrant = useCallback(
    (grantId: string) => {
      Alert.alert('撤销这台手机的访问？', '撤销后，这台手机需要重新向桌面申请，并由你再次在 Connector 中确认。', [
        { text: '取消', style: 'cancel' },
        {
          text: '撤销',
          style: 'destructive',
          onPress: () => {
            setBusyGrantId(grantId);
            void authorized((serverUrl, token) => revokeMobileAccess(serverUrl, token, grantId))
              .then(() => load('refresh'))
              .catch((cause: unknown) => {
                Alert.alert('撤销失败', describeMobileApiError(cause));
              })
              .finally(() => setBusyGrantId(null));
          },
        },
      ]);
    },
    [authorized, load],
  );

  const cancelRequest = useCallback(
    (grantId: string) => {
      Alert.alert('取消这次访问申请？', '取消后可以重新提交申请。', [
        { text: '保留', style: 'cancel' },
        {
          text: '取消申请',
          style: 'destructive',
          onPress: () => {
            setBusyGrantId(grantId);
            void authorized((serverUrl, token) => revokeMobileAccess(serverUrl, token, grantId))
              .then(() => load('refresh'))
              .catch((cause: unknown) => {
                Alert.alert('取消失败', describeMobileApiError(cause));
              })
              .finally(() => setBusyGrantId(null));
          },
        },
      ]);
    },
    [authorized, load],
  );

  if (!session) return null;

  return (
    <View style={[styles.page, { backgroundColor: theme.background }]}>
      <View style={[styles.body, { paddingTop: insets.top }]}>
        {error ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void load('refresh')}
            style={[styles.banner, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}
          >
            <Text style={[styles.bannerText, { color: theme.warning }]}>{error}</Text>
            <Text style={[styles.bannerAction, { color: theme.warning }]}>重试</Text>
          </Pressable>
        ) : null}

        {interactions.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${interactions.length} 个待处理的审批或提问`}
            onPress={openInteractions}
            style={[styles.banner, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}
          >
            <Text style={[styles.bannerText, { color: theme.accent }]}>
              {interactions.length} 个待处理的审批或提问
            </Text>
            <Text style={[styles.bannerAction, { color: theme.accent }]}>去处理</Text>
          </Pressable>
        ) : null}

        {loading && !overview ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.accent} />
            <Text style={[styles.loadingText, { color: theme.textSecondary }]}>正在同步授权与会话…</Text>
          </View>
        ) : tab === 'sessions' ? (
          <SessionsTab
            sessions={sessionList?.sessions ?? []}
            warnings={sessionList?.warnings ?? []}
            workspaceCount={workspaces.length}
            workspaceFilter={workspaceFilter}
            onClearFilter={() => setWorkspaceFilter(null)}
            onOpenSession={openSession}
            onRequestAccess={() => openRequestAccess()}
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            loading={loading}
          />
        ) : tab === 'interactions' ? (
          <InteractionsScreen embedded />
        ) : tab === 'devices' ? (
          <DevicesTab
            desktops={overview?.desktops ?? []}
            onRequestAccess={openRequestAccess}
            onCancelRequest={cancelRequest}
            onOpenSessions={() => {
              setWorkspaceFilter(null);
              setTab('sessions');
            }}
            onRevokeGrant={revokeGrant}
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            busyGrantId={busyGrantId}
          />
        ) : (
          <ProfileTab
            session={session}
            desktopCount={(overview?.desktops ?? []).filter(
              (desktop) => desktop.grant?.status === 'active',
            ).length}
            workspaceCount={workspaces.length}
            onDisconnect={disconnect}
            onRepair={() =>
              router.navigate({ pathname: '/connect', params: { server: session.serverUrl } })
            }
          />
        )}
      </View>
      <TabBar active={tab} onChange={setTab} badge={interactions.length} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  banner: {
    marginHorizontal: 20,
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bannerText: {
    flex: 1,
    fontSize: Typography.secondary,
    lineHeight: 20,
  },
  bannerAction: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '700',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: Typography.body,
    lineHeight: 20,
  },
});
