import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { EmptyState } from '@/components/empty-state';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  createMobileSession,
  createRequestId,
  describeMobileApiError,
  getMobileAccessOverview,
  promptMobileSession,
} from '@/lib/mobile-api';
import { useMobileSession } from '@/providers/mobile-session-provider';
import type {
  MobileAccessOverview,
  MobileDesktopAccess,
  MobileSession,
  MobileSessionCreateResult,
} from '@shared/types/mobile';

type CreateAttempt = {
  deviceId: string;
  workspaceId: string;
  text: string;
  createRequestId: string;
  promptRequestId: string;
};

export function NewSessionScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ deviceId?: string; workspaceId?: string }>();
  const { authorized, lastSession, rememberSession } = useMobileSession();
  const [overview, setOverview] = useState<MobileAccessOverview | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [attemptStarted, setAttemptStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [created, setCreated] = useState<MobileSessionCreateResult | null>(null);
  const attemptRef = useRef<CreateAttempt | null>(null);
  const creatingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await authorized((serverUrl, token) => getMobileAccessOverview(serverUrl, token));
      setOverview(next);
      setError(null);
    } catch (cause) {
      setError(describeMobileApiError(cause));
    } finally {
      setLoading(false);
    }
  }, [authorized]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const desktops = useMemo(
    () => (overview?.desktops ?? []).filter(
      (desktop) => desktop.grant?.status === 'active'
        && desktop.grant.scopes.includes('read')
        && desktop.grant.scopes.includes('prompt')
        && desktop.grant.workspaces.length > 0,
    ),
    [overview],
  );

  const requestedDeviceId = selectedDeviceId || params.deviceId || lastSession?.deviceId;
  const desktop = desktops.find((item) => item.deviceId === requestedDeviceId) ?? desktops[0];
  const workspaces = desktop?.grant?.workspaces ?? [];
  const requestedWorkspaceId = selectedWorkspaceId || (desktop?.deviceId === params.deviceId
    ? params.workspaceId
    : desktop?.deviceId === lastSession?.deviceId
      ? lastSession.workspaceId
      : undefined);
  const workspace = workspaces.find((item) => item.id === requestedWorkspaceId) ?? workspaces[0];
  const locked = attemptStarted || creating;

  const selectDevice = (next: MobileDesktopAccess) => {
    if (locked) return;
    setSelectedDeviceId(next.deviceId);
    setSelectedWorkspaceId(next.grant?.workspaces[0]?.id ?? '');
    setError(null);
  };

  const submit = async () => {
    if (creatingRef.current) return;
    const text = prompt.trim();
    if (!text) {
      setPromptError('请输入首条指令，再创建会话。');
      return;
    }
    if (!desktop?.online || !workspace || creating) return;

    const currentAttempt = attemptRef.current;
    if (currentAttempt && (
      currentAttempt.deviceId !== desktop.deviceId
      || currentAttempt.workspaceId !== workspace.id
      || currentAttempt.text !== text
    )) {
      setError('本次创建参数已变化。请返回后重新进入本页，避免重复创建或发送。');
      return;
    }
    const attempt = currentAttempt ?? {
      deviceId: desktop.deviceId,
      workspaceId: workspace.id,
      text,
      createRequestId: createRequestId('mcr'),
      promptRequestId: createRequestId('mpr'),
    };
    attemptRef.current = attempt;
    creatingRef.current = true;
    setAttemptStarted(true);
    setCreating(true);
    setError(null);
    setPromptError(null);

    try {
      const createdResult = created ?? await authorized((serverUrl, token) =>
        createMobileSession(serverUrl, token, {
          requestId: attempt.createRequestId,
          deviceId: attempt.deviceId,
          workspaceId: attempt.workspaceId,
        }),
      );
      setCreated(createdResult);
      await authorized((serverUrl, token) =>
        promptMobileSession(serverUrl, token, createdResult.sessionId, {
          requestId: attempt.promptRequestId,
          deviceId: attempt.deviceId,
          workspaceId: attempt.workspaceId,
          text: attempt.text,
        }),
      );

      const nextSession: MobileSession = {
        sessionId: createdResult.sessionId,
        title: sessionTitle(attempt.text),
        deviceId: attempt.deviceId,
        deviceName: desktop.deviceName,
        workspaceId: attempt.workspaceId,
        workspaceName: workspace.name,
        status: 'running',
        scopes: desktop.grant?.scopes ?? ['read', 'prompt'],
        updatedAt: new Date().toISOString(),
      };
      rememberSession(nextSession);
      router.replace({
        pathname: '/session/[sessionId]',
        params: {
          sessionId: nextSession.sessionId,
          deviceId: nextSession.deviceId,
          workspaceId: nextSession.workspaceId,
          title: nextSession.title,
          deviceName: nextSession.deviceName,
          workspaceName: nextSession.workspaceName,
          scopes: JSON.stringify(nextSession.scopes),
          awaitingReply: '1',
        },
      });
    } catch (cause) {
      setError(describeMobileApiError(cause));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.page, { backgroundColor: theme.background }]}
    >
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回会话"
          disabled={creating}
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, { borderColor: theme.border }, pressed && styles.pressed]}
        >
          <Text style={[styles.backIcon, { color: theme.text }]}>‹</Text>
        </Pressable>
        <View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>新建会话</Text>
          <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>在已授权的桌面工作区发起任务</Text>
        </View>
      </View>

      {loading && !overview ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>正在读取授权工作区…</Text>
        </View>
      ) : desktops.length === 0 ? (
        <View style={styles.empty}>
          {error ? (
            <EmptyState title="暂时无法读取工作区" description={error} actionLabel="重试" onAction={() => void load()} />
          ) : (
            <EmptyState
              title="没有可创建会话的工作区"
              description="需要桌面已授权，且这台手机同时具备查看和发送权限。"
              actionLabel="返回"
              onAction={() => router.back()}
            />
          )}
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {error ? (
              <View style={[styles.banner, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
                <Text style={[styles.bannerText, { color: theme.warning }]}>{error}</Text>
                {attemptStarted ? (
                  <Text style={[styles.bannerHint, { color: theme.warning }]}>
                    {created ? '会话已创建，首条指令尚未确认发送。' : '创建结果尚未确认。'}请保持当前内容并重试，系统会沿用原请求标识避免重复提交。
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={[styles.hero, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={[styles.heroIcon, { backgroundColor: theme.accentSoft }]}>
                <Text style={[styles.heroIconText, { color: theme.accent }]}>＋</Text>
              </View>
              <View style={styles.heroText}>
                <Text style={[styles.heroTitle, { color: theme.text }]}>发起一个桌面任务</Text>
                <Text style={[styles.heroCopy, { color: theme.textSecondary }]}>创建后立即发送首条指令，并进入会话查看执行进度。</Text>
              </View>
            </View>

            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>桌面设备</Text>
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              {desktops.map((item, index) => {
                const selected = item.deviceId === desktop?.deviceId;
                return (
                  <Pressable
                    key={item.deviceId}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: locked }}
                    disabled={locked}
                    onPress={() => selectDevice(item)}
                    style={({ pressed }) => [
                      styles.optionRow,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.radio, { borderColor: selected ? theme.accent : theme.border }]}>
                      {selected ? <View style={[styles.radioFill, { backgroundColor: theme.accent }]} /> : null}
                    </View>
                    <View style={styles.optionText}>
                      <Text style={[styles.optionTitle, { color: theme.text }]}>{item.deviceName}</Text>
                      <Text style={[styles.optionMeta, { color: item.online ? theme.success : theme.textSecondary }]}>
                        {item.online ? '在线 · Connector 已连接' : '离线 · 恢复在线后可创建'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>工作区</Text>
            <View style={styles.workspaceGrid}>
              {workspaces.map((item) => {
                const selected = item.id === workspace?.id;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: locked }}
                    disabled={locked}
                    onPress={() => setSelectedWorkspaceId(item.id)}
                    style={({ pressed }) => [
                      styles.workspaceOption,
                      { backgroundColor: selected ? theme.accentSoft : theme.surface, borderColor: selected ? theme.accent : theme.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text numberOfLines={1} style={[styles.workspaceName, { color: selected ? theme.accent : theme.text }]}>{item.name}</Text>
                    {selected ? <Text style={[styles.workspaceCheck, { color: theme.accent }]}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </View>
            {!desktop?.online ? (
              <View style={[styles.offline, { backgroundColor: theme.warningSoft }]}>
                <Text style={[styles.offlineText, { color: theme.warning }]}>这台桌面当前离线。你仍可填写指令，恢复在线后才能创建并发送。</Text>
              </View>
            ) : null}

            <View style={styles.promptLabel}>
              <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>首条指令</Text>
              <Text style={[styles.characterCount, { color: theme.textSecondary }]}>{prompt.length} / 500</Text>
            </View>
            <View style={[styles.promptCard, { backgroundColor: theme.surface, borderColor: promptError ? theme.danger : theme.border }]}>
              <TextInput
                accessibilityLabel="首条指令"
                editable={!locked}
                maxLength={500}
                multiline
                onChangeText={(value) => {
                  setPrompt(value);
                  setPromptError(null);
                }}
                placeholder="描述你希望 DSH 完成的任务…"
                placeholderTextColor={theme.textSecondary}
                style={[styles.promptInput, { color: theme.text }]}
                textAlignVertical="top"
                value={prompt}
              />
              <Text style={[styles.promptMeta, { color: theme.textSecondary, borderTopColor: theme.border }]}>创建后立即发送 · Agent 与模型跟随桌面默认</Text>
            </View>
            <Text style={[styles.promptHint, { color: promptError ? theme.danger : theme.textSecondary }]}>
              {promptError ?? '建议写清任务目标、范围和验收标准。'}
            </Text>
            {locked ? <Text style={[styles.lockedHint, { color: theme.textSecondary }]}>为避免重复提交，本次设备、工作区和首条指令已锁定。</Text> : null}
            <Text style={[styles.security, { color: theme.textSecondary }]}>仅使用已授权工作区，桌面审批策略保持不变。</Text>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text numberOfLines={1} style={[styles.footerSummary, { color: theme.textSecondary }]}>
              {desktop?.deviceName} · {workspace?.name ?? '请选择工作区'}
            </Text>
            <ActionButton
              accessibilityHint="创建会话并发送首条指令"
              disabled={!desktop?.online || !workspace || !desktop.grant}
              label={creating ? (created ? '正在发送首条指令…' : '正在创建会话…') : attemptStarted ? '重试创建并发送' : '创建并发送'}
              loading={creating}
              onPress={() => void submit()}
            />
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

function sessionTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 32 ? `${normalized.slice(0, 32)}…` : normalized;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 30, lineHeight: 32, marginTop: -2 },
  headerTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  headerSubtitle: { fontSize: Typography.caption, lineHeight: 18, marginTop: 2 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: Typography.body, lineHeight: 20 },
  empty: { flex: 1, justifyContent: 'center', padding: 20 },
  content: { padding: 16, paddingBottom: 24 },
  banner: { borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 14, gap: 5 },
  bannerText: { fontSize: Typography.body, lineHeight: 20, fontWeight: '600' },
  bannerHint: { fontSize: Typography.secondary, lineHeight: 20 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  heroIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  heroIconText: { fontSize: 23, lineHeight: 26 },
  heroText: { flex: 1, gap: 4 },
  heroTitle: { fontSize: Typography.reading, lineHeight: 22, fontWeight: '700' },
  heroCopy: { fontSize: Typography.body, lineHeight: 21 },
  sectionTitle: { fontSize: Typography.secondary, lineHeight: 19, fontWeight: '700', marginTop: 19, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  optionRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 10 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioFill: { width: 9, height: 9, borderRadius: 5 },
  optionText: { flex: 1, gap: 3 },
  optionTitle: { fontSize: Typography.control, lineHeight: 21, fontWeight: '600' },
  optionMeta: { fontSize: Typography.caption, lineHeight: 18 },
  workspaceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  workspaceOption: { minHeight: 42, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9 },
  workspaceName: { flexShrink: 1, fontSize: Typography.body, lineHeight: 20, fontWeight: '600' },
  workspaceCheck: { fontSize: Typography.body, lineHeight: 20, fontWeight: '700' },
  offline: { borderRadius: 11, padding: 10, marginTop: 10 },
  offlineText: { fontSize: Typography.secondary, lineHeight: 20 },
  promptLabel: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  characterCount: { fontSize: Typography.caption, lineHeight: 18, marginBottom: 8 },
  promptCard: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  promptInput: { minHeight: 124, maxHeight: 220, padding: 13, fontSize: Typography.reading, lineHeight: 24 },
  promptMeta: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 9, fontSize: Typography.caption, lineHeight: 18 },
  promptHint: { fontSize: Typography.secondary, lineHeight: 20, marginTop: 7 },
  lockedHint: { fontSize: Typography.secondary, lineHeight: 20, marginTop: 6 },
  security: { fontSize: Typography.caption, lineHeight: 18, textAlign: 'center', marginTop: 18 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 10 },
  footerSummary: { fontSize: Typography.caption, lineHeight: 18, textAlign: 'center', marginBottom: 8 },
  pressed: { opacity: 0.65 },
});
