import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useResponsiveLayout } from '@shared/hooks/use-responsive-layout';
import { DevicePickerSheet } from '@shared/components/device-picker-sheet';
import { DesktopIndicator, DeviceMenuChevron } from '@shared/components/session-header';
import { ChatIcon } from '@/components/chat-icon';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { describeMobileApiError, getMobileAccessOverview, getMobileSessions } from '@/lib/mobile-api';
import { formatRelative } from '@shared/lib/format';
import { settleMobileOverviewAndSessions } from '@shared/lib/mobile-overview-and-sessions';
import { useMobileSession } from '@/providers/mobile-session-provider';
import type { MobileDesktopAccess, MobileSession } from '@shared/types/mobile';

export function SessionDrawer({
  visible,
  currentSessionId,
  currentDeviceId,
  currentWorkspaceId,
  inline = false,
  onClose,
  onCreateSession,
  onOpenSession,
}: {
  visible: boolean;
  currentSessionId?: string;
  currentDeviceId?: string;
  currentWorkspaceId?: string;
  inline?: boolean;
  onClose: () => void;
  onCreateSession: (deviceId: string, workspaceId: string) => void;
  onOpenSession: (session: MobileSession) => void;
}) {
  const layout = useResponsiveLayout();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { authorized } = useMobileSession();
  const [desktops, setDesktops] = useState<MobileDesktopAccess[]>([]);
  const [sessions, setSessions] = useState<MobileSession[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [expandedWorkspace, setExpandedWorkspace] = useState('');
  const [sessionLimit, setSessionLimit] = useState(5);
  const [deviceMenu, setDeviceMenu] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slide] = useState(() => new Animated.Value(0));
  const identityRef = useRef({ currentSessionId, currentDeviceId, currentWorkspaceId });
  identityRef.current = { currentSessionId, currentDeviceId, currentWorkspaceId };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let available: MobileDesktopAccess[] = [];
      const result = await settleMobileOverviewAndSessions(
        authorized((server, token) => getMobileAccessOverview(server, token)),
        authorized((server, token) => getMobileSessions(server, token)),
        {
          overview: (access) => {
            available = access.desktops.filter((desktop) => desktop.grant?.status === 'active');
            setDesktops(available);
          },
          sessions: (list) => setSessions(list.sessions),
        },
      );
      if (result.overview.status === 'fulfilled') {
        const identity = identityRef.current;
        const currentSessions = result.sessions.status === 'fulfilled' ? result.sessions.value.sessions : [];
        const current = currentSessions.find((item) => item.sessionId === identity.currentSessionId);
        const nextDevice = current?.deviceId ?? identity.currentDeviceId ?? available[0]?.deviceId ?? '';
        const nextDesktop = available.find((desktop) => desktop.deviceId === nextDevice) ?? available[0];
        const nextWorkspace = current?.workspaceId
          ?? (nextDesktop?.deviceId === identity.currentDeviceId ? identity.currentWorkspaceId : undefined)
          ?? nextDesktop?.grant?.workspaces[0]?.id ?? '';
        setDeviceId(nextDesktop?.deviceId ?? '');
        setWorkspaceId(nextWorkspace);
        setExpandedWorkspace(nextWorkspace);
        setSessionLimit(5);
      }
      if (result.overview.status === 'rejected') {
        setError(describeMobileApiError(result.overview.reason));
      } else if (result.sessions.status === 'rejected') {
        setError(describeMobileApiError(result.sessions.reason));
      } else {
        setError(null);
      }
    } catch (cause) {
      setError(describeMobileApiError(cause));
    } finally {
      setLoading(false);
    }
  }, [authorized]);

  useEffect(() => {
    if (!visible) return;
    slide.setValue(inline ? 1 : 0);
    if (!inline) Animated.timing(slide, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [inline, load, slide, visible]);

  useEffect(() => {
    if (currentSessionId) {
      const current = sessions.find((session) => session.sessionId === currentSessionId);
      if (!current) return;
      setDeviceId(current.deviceId);
      setWorkspaceId(current.workspaceId);
      setExpandedWorkspace(current.workspaceId);
      return;
    }
    if (!currentDeviceId) return;
    setDeviceId(currentDeviceId);
    if (!currentWorkspaceId) return;
    setWorkspaceId(currentWorkspaceId);
    setExpandedWorkspace(currentWorkspaceId);
  }, [currentDeviceId, currentSessionId, currentWorkspaceId, sessions]);

  const desktop = desktops.find((item) => item.deviceId === deviceId) ?? desktops[0];
  const workspaces = desktop?.grant?.workspaces ?? [];
  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [-340, 0] });
  const deviceSessions = useMemo(
    () => sessions.filter((session) => session.deviceId === desktop?.deviceId),
    [desktop?.deviceId, sessions],
  );
  const canCreateInWorkspace = (id: string) => {
    const workspace = desktop?.grant?.workspaces.find((item) => item.id === id);
    return Boolean(
      desktop?.online
      && workspace?.scopes?.includes('read')
      && workspace.scopes.includes('prompt'),
    );
  };
  const selectedCanCreate = canCreateInWorkspace(workspaceId);
  const createInWorkspace = (id: string) => {
    if (!desktop || !canCreateInWorkspace(id)) return;
    onCreateSession(desktop.deviceId, id);
  };

  const selectDevice = (next: MobileDesktopAccess) => {
    setDeviceMenu(false);
    if (next.deviceId === desktop?.deviceId) return;
    const firstWorkspace = next.grant?.workspaces[0]?.id ?? '';
    setDeviceId(next.deviceId);
    setWorkspaceId(firstWorkspace);
    setExpandedWorkspace(firstWorkspace);
    setSessionLimit(5);
  };
  const closePicker = () => setDeviceMenu(false);
  const picker = deviceMenu && (
    <DevicePickerSheet
      devices={desktops}
      selectedId={desktop?.deviceId}
      loading={loading}
      error={error}
      colors={theme}
      desktopIcon={<ChatIcon name="desktop" size={24} color={theme.text} />}
      bottomInset={inline ? 0 : insets.bottom}
      centeredWidth={inline ? layout.sheetMaxWidth : undefined}
      onSelect={selectDevice}
      onClose={closePicker}
    />
  );

  const drawer = (
    <Animated.View
          accessibilityElementsHidden={deviceMenu}
          importantForAccessibility={deviceMenu ? 'no-hide-descendants' : 'auto'}
          style={[
            styles.drawer,
            inline && styles.inlineDrawer,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              paddingTop: insets.top,
              paddingBottom: inline ? 0 : insets.bottom,
              transform: [{ translateX: inline ? 0 : translateX }],
            },
          ]}
        >
          <View style={styles.deviceWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={desktop ? `切换桌面设备，${desktop.deviceName}，${desktop.online ? '在线' : '离线'}` : '选择桌面设备'}
              accessibilityState={{ expanded: deviceMenu }}
              onPress={() => setDeviceMenu(true)}
              style={({ pressed }) => [styles.deviceButton, pressed && styles.pressed]}
            >
              <DesktopIndicator Icon={ChatIcon} size={28} color={theme.text} online={desktop?.online}
                colors={theme} background={theme.surface} />
              <View style={styles.deviceText}>
                <Text numberOfLines={1} style={[styles.deviceName, { color: theme.text }]}>{desktop?.deviceName ?? '选择桌面'}</Text>
                <Text style={[styles.deviceMeta, { color: theme.textSecondary }]}>{desktop ? (desktop.online ? '在线 · Connector 已连接' : '离线 · 可查看历史会话') : '请选择桌面设备'}</Text>
              </View>
              <DeviceMenuChevron expanded={deviceMenu} color={theme.text} />
            </Pressable>
          </View>

          <View style={styles.drawerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="新建会话"
              accessibilityState={{ disabled: !selectedCanCreate }}
              disabled={!selectedCanCreate}
              onPress={() => createInWorkspace(workspaceId)}
              style={({ pressed }) => [
                styles.newButton,
                { borderColor: theme.border, backgroundColor: selectedCanCreate ? theme.surface : theme.surfaceMuted },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.newIcon, { color: selectedCanCreate ? theme.text : theme.textSecondary }]}>＋</Text>
              <Text style={[styles.newText, { color: selectedCanCreate ? theme.text : theme.textSecondary }]}>新建会话</Text>
              <Text numberOfLines={1} style={[styles.newWorkspace, { color: theme.textSecondary }]}>· {workspaces.find((item) => item.id === workspaceId)?.name ?? ''}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="同步会话"
              disabled={loading}
              onPress={() => void load()}
              style={[styles.syncButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
            >
              {loading ? <ActivityIndicator color={theme.accent} size="small" /> : <Text style={[styles.syncIcon, { color: theme.accent }]}>↻</Text>}
            </Pressable>
          </View>

          {error ? <Pressable onPress={() => void load()} style={[styles.error, { backgroundColor: theme.warningSoft }]}><Text style={[styles.errorText, { color: theme.warning }]}>{error} · 点击重试</Text></Pressable> : null}

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>工作区</Text>
              <Text style={[styles.sectionMeta, { color: theme.textSecondary }]}>{workspaces.length} 个 · 展开查看会话</Text>
            </View>
            {workspaces.map((workspace) => {
              const items = deviceSessions.filter((session) => session.workspaceId === workspace.id);
              const open = expandedWorkspace === workspace.id;
              const canCreate = canCreateInWorkspace(workspace.id);
              const shown = open ? items.slice(0, sessionLimit) : [];
              const remaining = Math.max(0, items.length - shown.length);
              return (
                <View key={workspace.id} style={styles.workspaceGroup}>
                  <View style={styles.workspaceRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      onPress={() => {
                        setWorkspaceId(workspace.id);
                        setExpandedWorkspace(open ? '' : workspace.id);
                        setSessionLimit(5);
                      }}
                      style={[styles.workspaceButton, workspace.id === workspaceId && { backgroundColor: theme.accentSoft }]}
                    >
                      <Text style={[styles.workspaceIcon, { color: workspace.id === workspaceId ? theme.accent : theme.textSecondary }]}>▱</Text>
                      <Text numberOfLines={1} style={[styles.workspaceName, { color: workspace.id === workspaceId ? theme.accent : theme.textSecondary }]}>{workspace.name}</Text>
                      <Text style={[styles.workspaceCount, { color: theme.textSecondary }]}>{items.length}</Text>
                      <Text style={[styles.chevron, { color: theme.textSecondary }]}>{open ? '⌄' : '›'}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`在 ${workspace.name} 中新建会话`}
                      accessibilityState={{ disabled: !canCreate }}
                      disabled={!canCreate}
                      onPress={() => createInWorkspace(workspace.id)}
                      style={({ pressed }) => [styles.workspaceAdd, pressed && styles.pressed]}
                    >
                      <Text style={[styles.workspaceAddText, { color: canCreate ? theme.accent : theme.textSecondary }]}>＋</Text>
                    </Pressable>
                  </View>
                  {open ? (
                    <View style={styles.sessionGroup}>
                      {items.length === 0 ? <Text style={[styles.empty, { color: theme.textSecondary }]}>这个工作区还没有会话</Text> : null}
                      {shown.map((session) => (
                        <Pressable
                          key={session.sessionId}
                          accessibilityRole="button"
                          onPress={() => onOpenSession(session)}
                          style={[styles.sessionButton, session.sessionId === currentSessionId && { backgroundColor: theme.accentSoft }]}
                        >
                          <View style={[styles.sessionDot, { backgroundColor: session.status === 'running' ? theme.accent : theme.success }]} />
                          <View style={styles.sessionText}>
                            <Text numberOfLines={1} style={[styles.sessionTitle, { color: theme.text }]}>{session.title}</Text>
                            <Text numberOfLines={1} style={[styles.sessionMeta, { color: theme.textSecondary }]}>{session.status === 'running' ? '运行中' : '空闲'}</Text>
                          </View>
                          <Text style={[styles.sessionTime, { color: theme.textSecondary }]}>{formatRelative(session.updatedAt)}</Text>
                        </Pressable>
                      ))}
                      {remaining > 0 ? (
                        <Pressable accessibilityRole="button" onPress={() => setSessionLimit(Number.MAX_SAFE_INTEGER)} style={styles.moreButton}>
                          <Text style={[styles.moreText, { color: theme.textSecondary }]}>查看更多（{remaining}）</Text>
                          <Text style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>
                        </Pressable>
                      ) : items.length > 5 ? (
                        <Pressable accessibilityRole="button" onPress={() => setSessionLimit(5)} style={styles.moreButton}>
                          <Text style={[styles.moreText, { color: theme.textSecondary }]}>收起</Text>
                          <Text style={[styles.chevron, { color: theme.textSecondary }]}>⌃</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <View style={[styles.smallDot, { backgroundColor: desktop?.online ? theme.success : theme.textSecondary }]} />
            <Text style={[styles.footerText, { color: theme.textSecondary }]}>{desktop?.online ? '设备在线' : '设备离线'} · 每个工作区默认展示 5 条会话</Text>
          </View>
    </Animated.View>
  );
  if (inline) return (
    <>
      {drawer}
      {deviceMenu && <Modal visible transparent animationType="fade" onRequestClose={closePicker}>{picker}</Modal>}
    </>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={deviceMenu ? closePicker : onClose}>
      <View style={styles.layer}>
        <Pressable accessible={!deviceMenu} accessibilityLabel="关闭会话侧边栏" onPress={onClose} style={[styles.backdrop, { backgroundColor: '#00000066' }]} />
        {drawer}
        {picker}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, flexDirection: 'row' },
  backdrop: { ...StyleSheet.absoluteFill },
  drawer: { width: '86%', maxWidth: 340, borderRightWidth: 1, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, elevation: 12 },
  inlineDrawer: { flex: 1, minHeight: 0, width: '100%', maxWidth: '100%', borderRightWidth: 0, shadowOpacity: 0, elevation: 0 },
  deviceWrap: { paddingHorizontal: 14, paddingTop: 15, paddingBottom: 9 },
  deviceButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  deviceText: { flex: 1, minWidth: 0 },
  deviceName: { fontSize: Typography.control, lineHeight: 21, fontWeight: '700' },
  deviceMeta: { fontSize: Typography.caption, lineHeight: 18, marginTop: 3 },
  smallDot: { width: 7, height: 7, borderRadius: 4 },
  drawerActions: { marginHorizontal: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  newButton: { flex: 1, minWidth: 0, minHeight: 42, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 10 },
  newIcon: { fontSize: 16, lineHeight: 19 },
  newText: { fontSize: Typography.body, lineHeight: 20, fontWeight: '700' },
  newWorkspace: { flexShrink: 1, fontSize: Typography.caption, lineHeight: 18 },
  syncButton: { width: 42, height: 42, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  syncIcon: { fontSize: 19, lineHeight: 22 },
  error: { marginHorizontal: 14, marginBottom: 8, padding: 9, borderRadius: 9 },
  errorText: { fontSize: Typography.secondary, lineHeight: 20 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 10, paddingBottom: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingTop: 12, paddingBottom: 7 },
  sectionTitle: { fontSize: Typography.secondary, lineHeight: 19, fontWeight: '600' },
  sectionMeta: { marginLeft: 'auto', fontSize: Typography.caption, lineHeight: 18 },
  workspaceGroup: { marginBottom: 3 },
  workspaceRow: { flexDirection: 'row', alignItems: 'center' },
  workspaceButton: { flex: 1, minHeight: 39, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, borderRadius: 10 },
  workspaceAdd: { width: 32, height: 36, marginRight: 3, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  workspaceAddText: { fontSize: 17, lineHeight: 20 },
  workspaceIcon: { fontSize: 17 },
  workspaceName: { flex: 1, fontSize: Typography.body, lineHeight: 20 },
  workspaceCount: { fontSize: Typography.caption, lineHeight: 18 },
  chevron: { fontSize: 14, lineHeight: 17 },
  sessionGroup: { paddingLeft: 19, paddingVertical: 3 },
  sessionButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 9, paddingVertical: 9, borderRadius: 10 },
  sessionDot: { width: 6, height: 6, borderRadius: 3 },
  sessionText: { flex: 1, minWidth: 0 },
  sessionTitle: { fontSize: Typography.body, lineHeight: 20, fontWeight: '600' },
  sessionMeta: { fontSize: Typography.caption, lineHeight: 18, marginTop: 3 },
  sessionTime: { flexShrink: 0, marginLeft: 4, fontSize: Typography.caption, lineHeight: 18 },
  moreButton: { marginLeft: 28, paddingHorizontal: 9, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moreText: { fontSize: Typography.secondary, lineHeight: 20 },
  empty: { padding: 16, fontSize: Typography.secondary, lineHeight: 20, textAlign: 'center' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 17, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerText: { flex: 1, fontSize: Typography.caption, lineHeight: 18 },
  pressed: { opacity: 0.65 },
});
