import { File } from 'expo-file-system';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { AdaptivePage } from '@/components/adaptive-page';
import { AttachmentDraftBar } from '@/components/attachment-draft-bar';
import { ChatIcon } from '@/components/chat-icon';
import { EmptyState } from '@/components/empty-state';
import { ModelSheet } from '@/features/session/model-sheet';
import { MoreOptionsSheet } from '@/features/session/more-options-sheet';
import { useNewSessionModel } from '@/features/session/use-new-session-model';
import { usePickedAttachmentCache } from '@/features/session/use-picked-attachment-cache';
import { SessionMaster } from '@/features/navigation/session-master';
import { useVoiceTranscription } from '@/features/session/use-voice-transcription';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { pickAttachments, type AttachmentSource } from '@/lib/attachment-picker';
import { shouldCancelVoiceGesture } from '@/lib/voice-gesture';
import {
  createMobileSession,
  createRequestId,
  describeMobileApiError,
  getMobileAccessOverview,
  promptMobileSession,
  selectMobileSessionModel,
  uploadMobileAttachment,
} from '@/lib/mobile-api';
import { KeyedPublishQueue } from '@shared/lib/keyed-publish-queue';
import { useResponsiveLayout } from '@shared/hooks/use-responsive-layout';
import { appendNewSessionTranscript, newSessionTitle, submitNewSessionDraft } from '@shared/lib/new-session-submit';
import { modelLabel, sameModelSelection } from '@shared/lib/session-model';
import {
  admitAttachment,
  canSubmitPrompt,
  MAX_PROMPT_ATTACHMENTS,
  type PromptAttachmentDraft,
} from '@shared/lib/prompt-attachments';
import { useInteractions } from '@/providers/interactions-provider';
import { useMobileSession } from '@/providers/mobile-session-provider';
import type {
  MobileAccessOverview,
  MobileDesktopAccess,
  MobileModelSelection,
  MobileSession,
  MobileSessionCreateResult,
} from '@shared/types/mobile';

const VOICE_WAVE_BARS = [6, 6, 10, 6, 14, 10, 20, 10, 14, 6, 10, 20, 14, 10, 6, 14, 20, 10, 6, 14, 10, 20, 10, 6, 6] as const;

type CreateAttempt = {
  deviceId: string;
  workspaceId: string;
  text: string;
  attachments: PromptAttachmentDraft[];
  modelSelection: MobileModelSelection | null;
  modelRequestId: string | null;
  createRequestId: string;
  promptRequestId: string;
};

export function NewSessionScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const { interactions } = useInteractions();
  const params = useLocalSearchParams<{ deviceId?: string; workspaceId?: string }>();
  const { authorized, lastSession, rememberSession } = useMobileSession();
  const [overview, setOverview] = useState<MobileAccessOverview | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<PromptAttachmentDraft[]>([]);
  const pickedAttachmentCache = usePickedAttachmentCache();
  const attachmentUploads = useRef(new KeyedPublishQueue<PromptAttachmentDraft>());
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [modelSelected, setModelSelected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [attemptStarted, setAttemptStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [created, setCreated] = useState<MobileSessionCreateResult | null>(null);
  const attemptRef = useRef<CreateAttempt | null>(null);
  const creatingRef = useRef(false);
  const onVoiceTranscript = useCallback((text: string) => {
    setPrompt((current) => appendNewSessionTranscript(current, text));
    setPromptError(null);
  }, []);
  const voice = useVoiceTranscription(onVoiceTranscript);
  const { voiceTouchStartY: voiceTouchStartYRef, voiceCancelArmedRef } = voice;

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
        && desktop.grant.workspaces.some(
          (workspace) => workspace.scopes?.includes('read') && workspace.scopes.includes('prompt'),
        ),
    ),
    [overview],
  );

  const requestedDeviceId = selectedDeviceId || params.deviceId || lastSession?.deviceId;
  const desktop = desktops.find((item) => item.deviceId === requestedDeviceId) ?? desktops[0];
  const workspaces = (desktop?.grant?.workspaces ?? []).filter(
    (workspace) => workspace.scopes?.includes('read') && workspace.scopes.includes('prompt'),
  );
  const requestedWorkspaceId = selectedWorkspaceId || (desktop?.deviceId === params.deviceId
    ? params.workspaceId
    : desktop?.deviceId === lastSession?.deviceId
      ? lastSession.workspaceId
      : undefined);
  const workspace = workspaces.find((item) => item.id === requestedWorkspaceId) ?? workspaces[0];
  const locked = attemptStarted || creating;
  const {
    catalog: modelCatalog,
    selection: modelSelection,
    loading: modelLoading,
    refreshing: modelRefreshing,
    error: modelError,
    refresh: refreshModel,
    selectModel: selectDraftModel,
  } = useNewSessionModel(desktop?.deviceId, workspace?.id);
  const openModelSheet = useCallback(() => {
    setModelSheetOpen(true);
    void refreshModel();
  }, [refreshModel]);

  const selectDevice = (next: MobileDesktopAccess) => {
    if (locked) return;
    setSelectedDeviceId(next.deviceId);
    setSelectedWorkspaceId(next.grant?.workspaces.find(
      (workspace) => workspace.scopes?.includes('read') && workspace.scopes.includes('prompt'),
    )?.id ?? '');
    setError(null);
  };

  const readAttachmentBytes = useCallback(async (uri: string): Promise<Uint8Array> => {
    return new File(uri).bytes();
  }, []);

  const uploadAttachment = useCallback(
    (item: PromptAttachmentDraft, target: { sessionId: string; deviceId: string; workspaceId: string }) =>
      attachmentUploads.current.run(item.localId, async () => {
        setAttachments((current) => current.map((entry) => entry.localId === item.localId ? { ...entry, state: 'uploading', error: undefined } : entry));
        let result: PromptAttachmentDraft;
        try {
          const bytes = await readAttachmentBytes(item.uri);
          const staged = await authorized((serverUrl, token) =>
            uploadMobileAttachment(serverUrl, token, target.sessionId, {
              deviceId: target.deviceId,
              workspaceId: target.workspaceId,
              name: item.name,
              mime: item.mime,
              bytes,
            }),
          );
          result = { ...item, state: 'ready', attachmentId: staged.attachmentId, kind: staged.kind, mime: staged.mime, bytes: staged.bytes, error: undefined };
        } catch (cause) {
          result = { ...item, state: 'failed', error: describeMobileApiError(cause) };
        }
        if (attemptRef.current) {
          attemptRef.current.attachments = attemptRef.current.attachments.map((entry) => entry.localId === result.localId ? result : entry);
        }
        setAttachments((current) => current.map((entry) => entry.localId === result.localId ? result : entry));
        return result;
      }),
    [authorized, readAttachmentBytes],
  );

  const addAttachments = useCallback(async (source: AttachmentSource) => {
    if (locked) return;
    setMoreOptionsOpen(false);
    const picked = await pickAttachments(source, { remainingSlots: MAX_PROMPT_ATTACHMENTS - attachments.length });
    if (picked.kind === 'canceled') return;
    if (picked.kind === 'denied') {
      Alert.alert('无法添加附件', picked.reason);
      return;
    }
    if (!pickedAttachmentCache.own(picked.drafts)) return;
    const accepted: PromptAttachmentDraft[] = [];
    let rejected: string | null = null;
    const next = [...attachments];
    for (const candidate of picked.drafts) {
      const admission = admitAttachment(candidate, next);
      if (admission.ok) {
        next.push(admission.draft);
        accepted.push(admission.draft);
      } else {
        pickedAttachmentCache.release([candidate]);
        rejected = admission.reason;
      }
    }
    setAttachments((current) => [
      ...current,
      ...accepted.filter((candidate) => !current.some((item) => item.localId === candidate.localId)),
    ]);
    if (accepted.length > 0) setPromptError(null);
    if (rejected) Alert.alert('部分附件未添加', rejected);
  }, [attachments, locked, pickedAttachmentCache]);

  const removeAttachment = useCallback((localId: string) => {
    const item = attachments.find((entry) => entry.localId === localId);
    if (item) pickedAttachmentCache.release([item]);
    setAttachments((current) => current.filter((entry) => entry.localId !== localId));
  }, [attachments, pickedAttachmentCache]);

  const retryAttachment = useCallback((localId: string) => {
    const attempt = attemptRef.current;
    if (!created || !attempt || creatingRef.current) return;
    const item = attempt.attachments.find((entry) => entry.localId === localId);
    if (!item || item.state === 'uploading') return;
    setUploadingAttachments(true);
    void uploadAttachment(item, { sessionId: created.sessionId, deviceId: attempt.deviceId, workspaceId: attempt.workspaceId })
      .finally(() => setUploadingAttachments(false));
  }, [created, uploadAttachment]);

  const submit = async () => {
    if (creatingRef.current || uploadingAttachments || voice.voiceActive) return;
    const text = prompt.trim();
    if (!canSubmitPrompt(text, attachments)) {
      setPromptError('请输入首条指令、添加附件，或使用语音输入。');
      return;
    }
    if (!desktop?.online || !workspace || creating) return;

    const currentAttempt = attemptRef.current;
    if (currentAttempt && (
      currentAttempt.deviceId !== desktop.deviceId
      || currentAttempt.workspaceId !== workspace.id
      || currentAttempt.text !== text
      || !sameModelSelection(currentAttempt.modelSelection, modelSelection)
    )) {
      setError('本次创建参数已变化。请返回后重新进入本页，避免重复创建或发送。');
      return;
    }
    const attempt = currentAttempt ?? {
      deviceId: desktop.deviceId,
      workspaceId: workspace.id,
      text,
      attachments,
      modelSelection,
      modelRequestId: modelSelection ? createRequestId('mmod') : null,
      createRequestId: createRequestId('mcr'),
      promptRequestId: createRequestId('mpr'),
    };
    attemptRef.current = attempt;
    creatingRef.current = true;
    setAttemptStarted(true);
    setCreating(true);
    setError(null);
    setPromptError(null);
    setUploadingAttachments(attempt.attachments.some((item) => item.state !== 'ready'));

    try {
      const result = await submitNewSessionDraft({
        created,
        modelSelected: modelSelected || attempt.modelSelection === null,
        attachments: attempt.attachments,
        createSession: () => authorized((serverUrl, token) =>
          createMobileSession(serverUrl, token, {
            requestId: attempt.createRequestId,
            deviceId: attempt.deviceId,
            workspaceId: attempt.workspaceId,
          }),
        ),
        onCreated: setCreated,
        selectModel: async (sessionId) => {
          const selection = attempt.modelSelection;
          const requestId = attempt.modelRequestId;
          if (!selection || !requestId) return;
          await authorized((serverUrl, token) => selectMobileSessionModel(serverUrl, token, sessionId, {
            requestId,
            deviceId: attempt.deviceId,
            workspaceId: attempt.workspaceId,
            provider: selection.provider,
            model: selection.model,
            ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
          }));
        },
        onModelSelected: () => setModelSelected(true),
        uploadAttachment: (item, sessionId) => uploadAttachment(item, {
          sessionId,
          deviceId: attempt.deviceId,
          workspaceId: attempt.workspaceId,
        }),
        onAttachments: (staged) => {
          attempt.attachments = [...staged];
          setAttachments([...staged]);
        },
        prompt: (sessionId, stagedIds) => authorized((serverUrl, token) =>
          promptMobileSession(serverUrl, token, sessionId, {
            requestId: attempt.promptRequestId,
            deviceId: attempt.deviceId,
            workspaceId: attempt.workspaceId,
            text: attempt.text,
            ...(stagedIds.length > 0 ? { attachmentIds: stagedIds } : {}),
          }),
        ),
      });
      setCreated(result.created);
      setModelSelected(result.modelSelected);
      if (!result.sent) {
        setError('附件尚未全部上传成功，首条指令尚未发送。可只重试失败附件，或点击重试继续。');
        return;
      }

      const nextSession: MobileSession = {
        sessionId: result.created.sessionId,
        title: newSessionTitle(attempt.text, attempt.attachments),
        deviceId: attempt.deviceId,
        deviceName: desktop.deviceName,
        workspaceId: attempt.workspaceId,
        workspaceName: workspace.name,
        status: 'running',
        scopes: desktop.grant?.scopes ?? ['read', 'prompt'],
        updatedAt: new Date().toISOString(),
      };
      pickedAttachmentCache.release(attempt.attachments);
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
      setUploadingAttachments(false);
    }
  };

  return (
    <AdaptivePage
      active="sessions"
      badge={interactions.length}
      onChange={(tab) => router.replace({ pathname: '/', params: { tab } })}
      master={<SessionMaster currentDeviceId={desktop?.deviceId} currentWorkspaceId={workspace?.id} />}
    >
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
            style={layout.isExpanded ? { alignSelf: 'center', width: '100%', maxWidth: layout.formMaxWidth } : undefined}
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
              {voice.voiceActive ? (
                <View pointerEvents="none" style={styles.voiceActivePanel}>
                  <View style={[styles.voiceGlow, styles.voiceGlowOuter, { backgroundColor: voice.voiceCancelArmed ? theme.danger : theme.accent }]} />
                  <View style={[styles.voiceGlow, styles.voiceGlowMiddle, { backgroundColor: voice.voiceCancelArmed ? theme.danger : theme.accent }]} />
                  <View style={[styles.voiceGlow, styles.voiceGlowInner, { backgroundColor: voice.voiceCancelArmed ? theme.danger : theme.accent }]} />
                  <Text accessibilityLiveRegion="polite" style={[styles.voiceActiveText, { color: voice.voiceCancelArmed ? theme.danger : theme.text }]}>
                    {voice.voiceActiveText}
                  </Text>
                  <View style={[styles.voiceWave, { opacity: voice.voiceStopping ? 0.55 : 1 }]}>
                    {VOICE_WAVE_BARS.map((height, index) => (
                      <View key={index} style={[styles.voiceWaveBar, { height, backgroundColor: voice.voiceCancelArmed ? theme.danger : theme.accent }]} />
                    ))}
                  </View>
                </View>
              ) : null}
              {voice.voiceActive ? null : (
                <AttachmentDraftBar
                  attachments={attachments}
                  disabled={creating || uploadingAttachments}
                  compositionLocked={attemptStarted}
                  onAdd={() => setMoreOptionsOpen(true)}
                  onRemove={removeAttachment}
                  onRetry={retryAttachment}
                />
              )}
              {voice.voiceActive ? null : attachments.filter((item) => item.state === 'failed').map((item) => (
                <Text key={item.localId} style={[styles.attachmentFailure, { color: theme.danger }]}>{item.name} 上传失败。{item.error}</Text>
              ))}
              <View style={[styles.promptComposerRow, voice.voiceActive && styles.composeBoxHidden]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={voice.voiceMode ? '切换为键盘输入' : '切换为语音输入'}
                  disabled={!voice.voiceEnabled || locked || voice.voicePreparing || voice.voiceListening || voice.voiceStopping || voice.systemVoiceClosing}
                  onPress={() => voice.setVoiceMode((current) => !current)}
                  style={({ pressed }) => [styles.voiceSwitch, { backgroundColor: voice.voiceMode ? theme.accentSoft : 'transparent', opacity: !voice.voiceEnabled || locked ? 0.45 : 1 }, pressed && styles.pressed]}
                >
                  <ChatIcon name={voice.voiceMode ? 'keyboard' : 'voice'} color={theme.accent} size={18} />
                </Pressable>
                {voice.voiceMode ? (
                  <View
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel="按住说话，松手完成，上移取消"
                    accessibilityState={{ disabled: locked || !voice.voiceEnabled || voice.voiceStopping || voice.systemVoiceClosing, busy: voice.voicePreparing || voice.voiceStopping }}
                    onStartShouldSetResponder={() => !locked && voice.voiceEnabled && !voice.voicePreparing && !voice.voiceListening && !voice.voiceStopping && !voice.voiceStarting.current && voice.systemVoiceGuard.canStart()}
                    onResponderTerminationRequest={() => false}
                    onResponderGrant={(event) => {
                      if (locked || voice.voicePreparing || voice.voiceListening || voice.voiceStopping || voice.voiceStarting.current || !voice.systemVoiceGuard.canStart()) return;
                      voiceTouchStartYRef.current = event.nativeEvent.pageY;
                      void voice.startVoice();
                    }}
                    onResponderMove={(event) => {
                      const startY = voiceTouchStartYRef.current;
                      if (startY === null || voice.voiceStopping) return;
                      const cancelArmed = shouldCancelVoiceGesture(startY, event.nativeEvent.pageY);
                      if (cancelArmed !== voiceCancelArmedRef.current) {
                        voiceCancelArmedRef.current = cancelArmed;
                        voice.setVoiceCancelArmed(cancelArmed);
                      }
                    }}
                    onResponderRelease={() => {
                      if (voiceTouchStartYRef.current === null) return;
                      if (voiceCancelArmedRef.current) voice.cancelVoice();
                      else voice.stopVoice();
                    }}
                    onResponderTerminate={() => {
                      if (voiceTouchStartYRef.current !== null) voice.cancelVoice();
                    }}
                    style={styles.holdTalk}
                  >
                    <Text style={[styles.holdTalkText, { color: theme.text }]}>
                      {voice.voicePreparing ? '正在准备…' : voice.voiceStopping ? '正在转写…' : voice.voiceListening ? '松手完成' : '按住说话'}
                    </Text>
                  </View>
                ) : (
                  <TextInput
                    accessibilityLabel="首条指令"
                    editable={!locked}
                    maxLength={500}
                    multiline
                    onChangeText={(value) => {
                      setPrompt(value);
                      setPromptError(null);
                    }}
                    placeholder="描述任务，或添加图片、使用语音输入…"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.promptInput, { color: theme.text }]}
                    textAlignVertical="top"
                    value={prompt}
                  />
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="更多输入选项"
                  disabled={locked || voice.voiceActive}
                  onPress={() => setMoreOptionsOpen(true)}
                  style={({ pressed }) => [styles.voiceSwitch, { opacity: locked ? 0.45 : 1 }, pressed && styles.pressed]}
                >
                  <Text style={[styles.moreOptionsText, { color: theme.textSecondary }]}>＋</Text>
                </Pressable>
              </View>
              <Text style={[styles.promptMeta, { color: theme.textSecondary, borderTopColor: theme.border }]}>
                {voice.voiceMode
                  ? '语音转写后仍可编辑 · 创建前请确认内容'
                  : `创建后立即发送 · ${modelCatalog ? `模型：${modelLabel(modelCatalog, modelCatalog.effective)}` : '模型跟随桌面默认'}`}
              </Text>
            </View>
            <Text style={[styles.promptHint, { color: promptError ? theme.danger : theme.textSecondary }]}>
              {promptError ?? '建议写清任务目标、范围和验收标准。'}
            </Text>
            {locked ? <Text style={[styles.lockedHint, { color: theme.textSecondary }]}>为避免重复提交，本次设备、工作区、模型、首条指令和附件已锁定；失败附件仍可单独重试。</Text> : null}
            <Text style={[styles.security, { color: theme.textSecondary }]}>仅使用已授权工作区，桌面审批策略保持不变。</Text>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text numberOfLines={1} style={[styles.footerSummary, { color: theme.textSecondary }]}>
              {desktop?.deviceName} · {workspace?.name ?? '请选择工作区'}
            </Text>
            <ActionButton
              accessibilityHint="创建会话并发送首条指令"
              disabled={!desktop?.online || !workspace || !desktop.grant || voice.voiceActive || uploadingAttachments}
              label={creating ? (created ? (uploadingAttachments ? '正在上传附件…' : '正在发送首条指令…') : '正在创建会话…') : attemptStarted ? '重试创建并发送' : '创建并发送'}
              loading={creating}
              onPress={() => void submit()}
            />
          </View>
        </>
      )}

      <MoreOptionsSheet
        visible={moreOptionsOpen}
        catalog={modelCatalog}
        refreshing={modelRefreshing}
        attachmentSlots={MAX_PROMPT_ATTACHMENTS - attachments.length}
        attachmentPurpose="first"
        onPickAttachments={(source) => void addAttachments(source)}
        onClose={() => setMoreOptionsOpen(false)}
        onOpenModel={() => {
          setMoreOptionsOpen(false);
          openModelSheet();
        }}
      />
      <ModelSheet
        visible={modelSheetOpen}
        catalog={modelCatalog}
        loading={modelLoading}
        refreshing={modelRefreshing}
        error={modelError}
        pending={null}
        canSelect={!locked}
        onClose={() => setModelSheetOpen(false)}
        onRefresh={refreshModel}
        onSelect={selectDraftModel}
      />
      </KeyboardAvoidingView>
    </AdaptivePage>
  );
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
  promptCard: { position: 'relative', borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  promptComposerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 7, paddingVertical: 6 },
  promptInput: { flex: 1, minHeight: 112, maxHeight: 220, paddingHorizontal: 4, paddingVertical: 8, fontSize: Typography.reading, lineHeight: 24 },
  voiceSwitch: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  moreOptionsText: { fontSize: 24, lineHeight: 28, fontWeight: '500' },
  holdTalk: { flex: 1, minHeight: 112, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  holdTalkText: { fontSize: Typography.control, lineHeight: 22, fontWeight: '600' },
  composeBoxHidden: { opacity: 0 },
  attachmentFailure: { fontSize: Typography.caption, lineHeight: 18, paddingHorizontal: 10, paddingBottom: 6 },
  voiceActivePanel: { position: 'absolute', zIndex: 2, left: 0, right: 0, bottom: 33, height: 174, alignItems: 'center', paddingTop: 42 },
  voiceGlow: { position: 'absolute', bottom: -120, width: 260, height: 210, borderRadius: 130, transform: [{ scaleX: 1.45 }] },
  voiceGlowOuter: { bottom: -100, width: 300, height: 230, opacity: 0.06 },
  voiceGlowMiddle: { bottom: -110, width: 270, height: 210, opacity: 0.1 },
  voiceGlowInner: { width: 230, height: 190, opacity: 0.16 },
  voiceActiveText: { fontSize: Typography.control, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  voiceWave: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 20 },
  voiceWaveBar: { width: 4, borderRadius: 2 },
  promptMeta: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 9, fontSize: Typography.caption, lineHeight: 18 },
  promptHint: { fontSize: Typography.secondary, lineHeight: 20, marginTop: 7 },
  lockedHint: { fontSize: Typography.secondary, lineHeight: 20, marginTop: 6 },
  security: { fontSize: Typography.caption, lineHeight: 18, textAlign: 'center', marginTop: 18 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 10 },
  footerSummary: { fontSize: Typography.caption, lineHeight: 18, textAlign: 'center', marginBottom: 8 },
  pressed: { opacity: 0.65 },
});
