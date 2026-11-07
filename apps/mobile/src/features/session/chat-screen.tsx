import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InteractionCard } from '@/features/interactions/interaction-card';
import { ModelSheet } from '@/features/session/model-sheet';
import { MoreOptionsSheet } from '@/features/session/more-options-sheet';
import { SessionModelProvider, useSessionModel } from '@/features/session/session-model-provider';
import { SessionDrawer } from '@/features/navigation/session-drawer';
import { TabBar, type HomeTab } from '@/components/tab-bar';
import { MarkdownText } from '@/components/markdown';
import { TurnCard } from '@/components/turn-card';
import { ChatIcon } from '@/components/chat-icon';
import { StatusBadge } from '@/components/status-badge';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { groupTurns } from '@/lib/turn-grouping';
import {
  cancelMobileSession,
  createRequestId,
  describeMobileApiError,
  getMobileTranscript,
  promptMobileSession,
} from '@/lib/mobile-api';
import { formatTime } from '@/lib/format';
import { markdownToPlainText } from '@/lib/markdown';
import { resolvePendingReply } from '@/lib/pending-reply';
import { modelLabel } from '@/lib/session-model';
import { shouldCancelVoiceGesture } from '@/lib/voice-gesture';
import { openSessionStream } from '@/lib/session-stream';
import { SystemVoiceSessionGuard } from '@/lib/system-voice-session';
import { openVolcAsrSession, type VolcAsrSession } from '@/lib/volc-asr';
import { useInteractions } from '@/providers/interactions-provider';
import { AttachmentGrid } from '@/components/attachment-grid';
import { AttachmentViewer } from '@/components/attachment-viewer';
import type { AttachmentAuth } from '@/components/attachment-grid';
import { useMobileSession } from '@/providers/mobile-session-provider';
import { useVoice } from '@/providers/voice-provider';
import type { MobileMessage, MobileSession, MobileTranscript } from '@/types/mobile';

const VOICE_WAVE_BARS = [6, 6, 10, 6, 14, 10, 20, 10, 14, 6, 10, 20, 14, 10, 6, 14, 20, 10, 6, 14, 10, 20, 10, 6, 6] as const;

export function ChatScreen() {
  const params = useLocalSearchParams<{ sessionId: string; deviceId: string; workspaceId: string }>();
  const sessionId = single(params.sessionId);
  const deviceId = single(params.deviceId);
  const workspaceId = single(params.workspaceId);
  const identity = `${deviceId}:${workspaceId}:${sessionId}`;
  return (
    <SessionModelProvider key={identity} deviceId={deviceId} workspaceId={workspaceId} sessionId={sessionId}>
      <ChatScreenContent />
    </SessionModelProvider>
  );
}

function ChatScreenContent() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { authorized, session, connection, rememberSession } = useMobileSession();
  // Attachment images need a live bearer token in their request headers, so the
  // screen resolves one connection snapshot and refreshes it with the session.
  const [attachmentAuth, setAttachmentAuth] = useState<AttachmentAuth | null>(null);
  const { settings: voiceSettings, hydrated: voiceHydrated, speak } = useVoice();
  const { interactions, busyId, decide } = useInteractions();
  const params = useLocalSearchParams<{
    sessionId: string;
    deviceId: string;
    workspaceId: string;
    title?: string;
    deviceName?: string;
    workspaceName?: string;
    scopes?: string;
    awaitingReply?: string;
  }>();

  const sessionId = single(params.sessionId);
  const deviceId = single(params.deviceId);
  const workspaceId = single(params.workspaceId);
  const title = single(params.title) || '会话';
  const deviceName = single(params.deviceName) || '';
  const workspaceName = single(params.workspaceName) || '';
  const scopes = useMemo(() => parseScopes(single(params.scopes)), [params.scopes]);
  useEffect(() => {
    if (!sessionId || !deviceId || !workspaceId) return;
    rememberSession({ sessionId, deviceId, workspaceId, title, deviceName, workspaceName, scopes, status: 'idle', updatedAt: new Date().toISOString() });
  }, [deviceId, deviceName, rememberSession, scopes, sessionId, title, workspaceId, workspaceName]);

  const [transcript, setTranscript] = useState<MobileTranscript | null>(null);
  const [older, setOlder] = useState<MobileMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | undefined>();
  const [olderHasMore, setOlderHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const {
    data: modelCatalog,
    loading: modelLoading,
    refreshing: modelRefreshing,
    error: modelError,
    pending: modelPending,
    refresh: refreshModel,
    selectModel,
  } = useSessionModel();
  const [voiceMode, setVoiceMode] = useState(false);
  const [voicePreparing, setVoicePreparing] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStopping, setVoiceStopping] = useState(false);
  const [voiceCancelArmed, setVoiceCancelArmed] = useState(false);
  const [systemVoiceClosing, setSystemVoiceClosing] = useState(false);
  const [systemVoiceGuard] = useState(() => new SystemVoiceSessionGuard());
  const voiceTextRef = useRef('');
  const voiceStopRequested = useRef(false);
  const voiceStarting = useRef(false);
  const voiceTouchStartY = useRef<number | null>(null);
  const voiceCancelArmedRef = useRef(false);
  const voiceStartGeneration = useRef(0);
  const cloudSessionRef = useRef<VolcAsrSession | null>(null);
  const pendingPcmRef = useRef<Uint8Array | null>(null);
  const audioStreamOwnerRef = useRef<number | null>(null);
  const audioStreamStopRef = useRef<() => void>(() => undefined);
  const voiceFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechInitialized = useRef(false);
  const lastSpokenSeq = useRef(0);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [optimistic, setOptimistic] = useState<MobileMessage | null>(null);
  const [pendingReply, setPendingReply] = useState<
    { since: number; afterSeq: number; text: string; userObserved?: boolean } | null
  >(() => single(params.awaitingReply) === '1' ? { since: Date.now(), afterSeq: 0, text: '' } : null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [streamText, setStreamText] = useState('');
  const inflight = useRef(false);
  const cursorInitialized = useRef(false);
  const latestSeqRef = useRef(0);
  const streamClearAfter = useRef(0);
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const stickToBottom = useRef(true);

  const resetVoice = useCallback(() => {
    voiceStarting.current = false;
    voiceTouchStartY.current = null;
    voiceCancelArmedRef.current = false;
    setVoicePreparing(false);
    setVoiceListening(false);
    setVoiceStopping(false);
    setVoiceCancelArmed(false);
    setVoiceMode(false);
    voiceTextRef.current = '';
    pendingPcmRef.current = null;
  }, []);
  const markSystemVoiceClosing = useCallback(() => {
    systemVoiceGuard.beginClosing();
    setSystemVoiceClosing(true);
  }, [systemVoiceGuard]);
  const clearVoiceFinishTimer = useCallback(() => {
    if (voiceFinishTimerRef.current !== null) clearTimeout(voiceFinishTimerRef.current);
    voiceFinishTimerRef.current = null;
  }, []);
  const stopCloudAudio = useCallback((expectedGeneration?: number) => {
    const owner = audioStreamOwnerRef.current;
    if (expectedGeneration !== undefined && owner !== null && owner !== expectedGeneration) return;
    audioStreamStopRef.current();
    if (expectedGeneration === undefined || owner === expectedGeneration) audioStreamOwnerRef.current = null;
    void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, []);
  const finishCloudVoice = useCallback((text: string) => {
    clearVoiceFinishTimer();
    cloudSessionRef.current = null;
    stopCloudAudio();
    resetVoice();
    const transcript = text.trim();
    if (transcript) setDraft((current) => `${current.trim() ? `${current.trim()}\n` : ''}${transcript}`);
  }, [clearVoiceFinishTimer, resetVoice, stopCloudAudio]);
  const failCloudVoice = useCallback((cause: unknown) => {
    clearVoiceFinishTimer();
    cloudSessionRef.current?.abort();
    cloudSessionRef.current = null;
    stopCloudAudio();
    resetVoice();
    Alert.alert('语音识别未完成', cause instanceof Error ? cause.message : '请稍后重试。');
  }, [clearVoiceFinishTimer, resetVoice, stopCloudAudio]);

  const { stream: audioStream } = useAudioStream({
    sampleRate: 16_000,
    channels: 1,
    encoding: 'int16',
    onBuffer: (buffer) => {
      const session = cloudSessionRef.current;
      if (!session) return;
      if (buffer.sampleRate !== 16_000 || buffer.channels !== 1) {
        failCloudVoice(new Error(`当前麦克风输出为 ${buffer.sampleRate} Hz / ${buffer.channels} 声道，无法按 16 kHz 单声道识别。`));
        return;
      }
      try {
        const previous = pendingPcmRef.current;
        pendingPcmRef.current = new Uint8Array(buffer.data.slice(0));
        if (previous) session.sendAudio(previous);
      } catch (cause) {
        failCloudVoice(cause);
      }
    },
  });
  useEffect(() => {
    audioStreamStopRef.current = () => audioStream?.stop();
  }, [audioStream]);

  useSpeechRecognitionEvent('start', () => {
    if (voiceSettings.asrProvider !== 'system' || systemVoiceGuard.isClosing()) return;
    if (voiceStopRequested.current) {
      markSystemVoiceClosing();
      ExpoSpeechRecognitionModule.abort();
      resetVoice();
      return;
    }
    voiceStarting.current = false;
    setVoicePreparing(false);
    setVoiceListening(true);
    setVoiceStopping(false);
  });
  useSpeechRecognitionEvent('result', (event) => {
    if (voiceSettings.asrProvider !== 'system' || systemVoiceGuard.isClosing()) return;
    const text = event.results[0]?.transcript?.trim() ?? '';
    if (!text) return;
    voiceTextRef.current = text;
  });
  useSpeechRecognitionEvent('end', () => {
    if (voiceSettings.asrProvider !== 'system') return;
    if (systemVoiceGuard.consumeTerminalEnd()) {
      // Native events have no session ID. Consume the cancelled/failed session's
      // terminal end before allowing another recording to start.
      setSystemVoiceClosing(false);
      voiceTextRef.current = '';
      return;
    }
    const text = voiceTextRef.current.trim();
    resetVoice();
    if (text) setDraft((current) => `${current.trim() ? `${current.trim()}\n` : ''}${text}`);
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (voiceSettings.asrProvider !== 'system') return;
    if (event.error === 'aborted') {
      if (!systemVoiceGuard.isClosing()) {
        markSystemVoiceClosing();
        resetVoice();
      }
      return;
    }
    if (systemVoiceGuard.isClosing()) return;
    markSystemVoiceClosing();
    resetVoice();
    Alert.alert('语音识别未完成', event.message || '请检查麦克风权限和系统语音识别服务后重试。');
  });
  useEffect(() => () => {
    voiceStartGeneration.current += 1;
    voiceStopRequested.current = true;
    voiceStarting.current = false;
    clearVoiceFinishTimer();
    ExpoSpeechRecognitionModule.abort();
    cloudSessionRef.current?.abort();
    stopCloudAudio();
  }, [clearVoiceFinishTimer, stopCloudAudio]);

  const canPrompt = scopes.includes('prompt');
  const canCancel = scopes.includes('cancel');
  const openModelSheet = useCallback(() => {
    setModelSheetOpen(true);
    void refreshModel();
  }, [refreshModel]);
  const openMoreOptions = useCallback(() => {
    setMoreOptionsOpen(true);
    void refreshModel();
  }, [refreshModel]);
  const sessionInteractions = interactions.filter((item) => item.sessionId === sessionId);

  const loadLatest = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
      if (!sessionId || !deviceId || !workspaceId) {
        setError('会话参数不完整，请返回后重试。');
        setLoading(false);
        return;
      }
      if (inflight.current) return;
      inflight.current = true;
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const next = await authorized((serverUrl, token) =>
          getMobileTranscript(serverUrl, token, sessionId, { deviceId, workspaceId, limit: 30 }),
        );
        setTranscript(next);
        setOptimistic((current) => {
          if (!current) return current;
          const matched = next.messages.some(
            (message) => message.role === 'user' && message.text === current.text,
          );
          return matched ? null : current;
        });
        setPendingReply((current) => current ? resolvePendingReply(current, next) : current);
        latestSeqRef.current = next.messages.reduce(
          (highest, message) => Math.max(highest, message.seq),
          0,
        );
        const finalized = next.messages.some(
          (message) => message.role === 'assistant' && message.seq > streamClearAfter.current,
        );
        if (finalized) {
          setStreamText((current) => (current ? '' : current));
        }
        if (!cursorInitialized.current) {
          cursorInitialized.current = true;
          setOlderCursor(next.nextCursor);
          setOlderHasMore(next.hasMore);
        }
        setError(null);
      } catch (cause) {
        setError(describeMobileApiError(cause));
      } finally {
        inflight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authorized, deviceId, sessionId, workspaceId],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadLatest('initial');
    }, 0);
    return () => clearTimeout(timer);
  }, [loadLatest]);

  const awaitingReply = sending || pendingReply !== null || transcript?.active === true;
  const waitingForAttachments = transcript?.messages.some((message) =>
    message.attachments?.some((attachment) => attachment.state === 'fetching'),
  ) === true;
  const shouldStream = Boolean(
    session && (sending || pendingReply !== null || transcript?.active === true || waitingForAttachments),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      void loadLatest('silent');
    }, awaitingReply ? 1_800 : 3_000);
    return () => clearInterval(timer);
  }, [awaitingReply, loadLatest]);

  useEffect(() => {
    if (!awaitingReply) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [awaitingReply]);

  useEffect(() => {
    if (!shouldStream) return;
    let disposed = false;
    let socket: { close: () => void } | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let retryScheduled = false;

    function scheduleReconnect(): void {
      if (disposed || retryScheduled) return;
      retryScheduled = true;
      const delay = Math.min(1_000 * 2 ** Math.min(attempts, 3), 8_000);
      attempts += 1;
      retryTimer = setTimeout(() => {
        retryScheduled = false;
        void connect();
      }, delay);
    }

    async function connect(): Promise<void> {
      if (disposed) return;
      try {
        const current = await connection();
        if (disposed) return;
        socket = openSessionStream(
          {
            serverUrl: current.serverUrl,
            accessToken: current.accessToken,
            deviceId,
            workspaceId,
            sessionId,
          },
          {
            onOpen: () => {
              attempts = 0;
              retryScheduled = false;
            },
            onClose: () => {
              scheduleReconnect();
            },
            onStart: () => undefined,
            onDelta: (text) => {
              setStreamText((currentText) => currentText + text);
            },
            onEnd: () => {
              void loadLatest('silent');
            },
            onRefresh: () => {
              void loadLatest('silent');
            },
            onModelRefresh: () => {
              void refreshModel(true);
            },
            onError: () => undefined,
          },
        );
      } catch {
        scheduleReconnect();
      }
    }

    if (streamClearAfter.current === 0) streamClearAfter.current = latestSeqRef.current;
    void connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [
    connection,
    deviceId,
    loadLatest,
    refreshModel,
    session?.accessToken,
    sessionId,
    shouldStream,
    workspaceId,
  ]);

  const messages = useMemo(() => {
    const map = new Map<number, MobileMessage>();
    for (const message of [...older, ...(transcript?.messages ?? [])]) {
      map.set(message.seq, message);
    }
    const result = [...map.values()].sort((left, right) => left.seq - right.seq);
    if (optimistic) {
      result.push({
        ...optimistic,
        seq: Number.MAX_SAFE_INTEGER,
      });
    }
    return result;
  }, [older, optimistic, transcript]);

  const conversation = useMemo(
    () => messages.filter((message) => !(message.role === 'user' && isInjectedContext(message.text))),
    [messages],
  );
  const turns = useMemo(() => groupTurns(conversation), [conversation]);
  // While a new prompt is optimistic, the still-executing turn is the last one
  // with content rather than the trailing user-only group.
  const runningIndex = transcript?.active === true
    ? turns.reduce(
      (latest, turn, index) => (
        turn.steps.length > 0 || turn.final || turn.attachments.length > 0 ? index : latest
      ),
      -1,
    )
    : -1;
  const runningTurn = runningIndex >= 0 ? turns[runningIndex] : undefined;
  const runningHasContent = Boolean(
    runningTurn && (runningTurn.steps.length > 0 || runningTurn.final || runningTurn.attachments.length > 0),
  );

  const waitSeconds = pendingReply
    ? Math.max(0, Math.floor((nowTick - pendingReply.since) / 1_000))
    : 0;
  const waitingTitle = sending
    ? '正在发送指令…'
    : transcript?.active
      ? 'DSH 正在执行…'
      : pendingReply && waitSeconds < 3
        ? '已送达桌面，正在唤醒 DSH…'
        : '已排队，等待 DSH 返回响应…';
  const waitingHint = sending
    ? '正在提交到当前授权会话。'
    : error
      ? '自动刷新暂时失败，请检查桌面与 Server 的连接后重试。'
      : awaitingReply && waitSeconds >= 45
        ? '还没有收到响应。桌面可能正在等待审批、仍在执行，或 Connector 已断开。可以立即刷新确认。'
        : '响应会自动刷新；需要立即确认时可以手动刷新。';
  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const resolveAttachmentAuth = async () => {
      try {
        const { serverUrl, accessToken } = await connection();
        if (!disposed) setAttachmentAuth({ serverUrl, accessToken });
      } catch {
        if (disposed) return;
        setAttachmentAuth(null);
        // A transient refresh/network failure must not leave every image blank
        // for the whole time this screen stays open.
        retryTimer = setTimeout(() => void resolveAttachmentAuth(), 1_000);
      }
    };
    void resolveAttachmentAuth();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [connection, session?.accessToken]);

  const canRefreshManually = awaitingReply && (waitSeconds >= 6 || error !== null);
  const lastCompletedTurn = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      if (index === runningIndex) continue;
      const group = turns[index];
      if (group?.final && group.final.text.trim().length > 0) return group;
    }
    return undefined;
  }, [turns, runningIndex]);
  useEffect(() => {
    const latest = lastCompletedTurn?.final;
    if (!latest || !lastCompletedTurn) return;
    if (!speechInitialized.current) {
      speechInitialized.current = true;
      lastSpokenSeq.current = latest.seq;
      return;
    }
    if (latest.seq === lastSpokenSeq.current) return;
    lastSpokenSeq.current = latest.seq;
    if (voiceHydrated && voiceSettings.autoPlay && !transcript?.active && !streamText) {
      void speak(markdownToPlainText(latest.text), { key: `turn-${lastCompletedTurn.key}` }).catch((cause: unknown) => {
        Alert.alert('语音播报失败', cause instanceof Error ? cause.message : '请稍后重试。');
      });
    }
  }, [lastCompletedTurn, speak, streamText, transcript?.active, voiceHydrated, voiceSettings.autoPlay]);

  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await authorized((serverUrl, token) =>
        getMobileTranscript(serverUrl, token, sessionId, {
          deviceId,
          workspaceId,
          cursor: olderCursor,
          limit: 30,
        }),
      );
      setOlder((current) => {
        const map = new Map<number, MobileMessage>();
        for (const message of [...page.messages, ...current]) map.set(message.seq, message);
        return [...map.values()].sort((left, right) => left.seq - right.seq);
      });
      setOlderCursor(page.nextCursor);
      setOlderHasMore(page.hasMore);
    } catch (cause) {
      Alert.alert('加载更早消息失败', describeMobileApiError(cause));
    } finally {
      setLoadingOlder(false);
    }
  }, [authorized, deviceId, loadingOlder, olderCursor, sessionId, workspaceId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !canPrompt || modelPending) return;
    const requestId = createRequestId('mpr');
    const afterSeq = (transcript?.messages ?? []).reduce(
      (highest, message) => Math.max(highest, message.seq),
      0,
    );
    streamClearAfter.current = afterSeq;
    setSending(true);
    setDraft('');
    setOptimistic({
      id: `local-${requestId}`,
      seq: Number.MAX_SAFE_INTEGER,
      role: 'user',
      text,
      occurredAt: new Date().toISOString(),
    });
    stickToBottom.current = true;
    try {
      await authorized((serverUrl, token) =>
        promptMobileSession(serverUrl, token, sessionId, {
          requestId,
          deviceId,
          workspaceId,
          text,
        }),
      );
      setPendingReply({ since: Date.now(), afterSeq, text });
      setNowTick(Date.now());
      await loadLatest('silent');
    } catch (cause) {
      setOptimistic(null);
      setPendingReply(null);
      setDraft(text);
      Alert.alert('发送失败', describeMobileApiError(cause));
    } finally {
      setSending(false);
    }
  };

  const cancel = () => {
    Alert.alert('停止当前执行？', '只会取消这个会话当前的 Turn，不会删除会话或已生成的内容。', [
      { text: '继续执行', style: 'cancel' },
      {
        text: '停止',
        style: 'destructive',
        onPress: () => {
          setCancelling(true);
          void authorized((serverUrl, token) =>
            cancelMobileSession(serverUrl, token, sessionId, {
              requestId: createRequestId('mcan'),
              deviceId,
              workspaceId,
            }),
          )
            .then(() => {
              setPendingReply(null);
              return loadLatest('silent');
            })
            .catch((cause: unknown) => Alert.alert('停止失败', describeMobileApiError(cause)))
            .finally(() => setCancelling(false));
        },
      },
    ]);
  };

  const startCloudVoice = async (generation: number) => {
    if (Platform.OS === 'web') throw new Error('浏览器无法传递火山 ASR 所需的 WebSocket 鉴权头，请改用系统 ASR 或移动端 Development Build。');
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error('请允许麦克风权限后重试。');
    if (generation !== voiceStartGeneration.current || voiceStopRequested.current) return;

    let session: VolcAsrSession;
    session = openVolcAsrSession(
      { apiKey: voiceSettings.apiKey, endpoint: voiceSettings.endpoint, protocol: voiceSettings.asrProtocol },
      {
        onOpen: () => {
          void (async () => {
            try {
              if (generation !== voiceStartGeneration.current || voiceStopRequested.current) {
                session.abort();
                return;
              }
              audioStreamOwnerRef.current = generation;
              await setAudioModeAsync({
                allowsRecording: true,
                playsInSilentMode: true,
                shouldPlayInBackground: false,
                interruptionMode: 'doNotMix',
              });
              if (generation !== voiceStartGeneration.current || voiceStopRequested.current) {
                stopCloudAudio(generation);
                session.abort();
                return;
              }
              await audioStream.start();
              if (generation !== voiceStartGeneration.current || voiceStopRequested.current) {
                stopCloudAudio(generation);
                session.abort();
                return;
              }
              if (audioStream.sampleRate !== 16_000 || audioStream.channels !== 1) {
                throw new Error(`当前麦克风输出为 ${audioStream.sampleRate} Hz / ${audioStream.channels} 声道，无法按 16 kHz 单声道识别。`);
              }
              voiceStarting.current = false;
              setVoicePreparing(false);
              setVoiceListening(true);
              setVoiceStopping(false);
            } catch (cause) {
              if (generation === voiceStartGeneration.current) failCloudVoice(cause);
              else {
                stopCloudAudio(generation);
                session.abort();
              }
            }
          })();
        },
        onText: (text) => {
          if (generation !== voiceStartGeneration.current) return;
          voiceTextRef.current = text;
              },
        onComplete: (text) => {
          if (generation === voiceStartGeneration.current) finishCloudVoice(text);
        },
        onError: (cause) => {
          if (generation === voiceStartGeneration.current) failCloudVoice(cause);
        },
      },
    );
    cloudSessionRef.current = session;
  };

  const startVoice = async () => {
    if (!voiceHydrated || !voiceSettings.enabled || voiceListening || voiceStarting.current || !systemVoiceGuard.canStart()) return;
    const generation = ++voiceStartGeneration.current;
    voiceStarting.current = true;
    voiceTextRef.current = '';
    voiceCancelArmedRef.current = false;
    pendingPcmRef.current = null;
    voiceStopRequested.current = false;
    clearVoiceFinishTimer();
    setVoicePreparing(true);
    setVoiceStopping(false);
    setVoiceCancelArmed(false);
    setVoiceMode(true);
    try {
      if (voiceSettings.asrProvider === 'volcengine') {
        await startCloudVoice(generation);
        return;
      }
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        throw new Error('请启用系统语音识别服务后重试。');
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) throw new Error('请允许麦克风和系统语音识别权限后重试。');
      if (generation !== voiceStartGeneration.current || voiceStopRequested.current) return;
      ExpoSpeechRecognitionModule.start({ lang: voiceSettings.language, interimResults: true, continuous: false, maxAlternatives: 1 });
    } catch (cause) {
      if (generation !== voiceStartGeneration.current) return;
      if (voiceSettings.asrProvider === 'volcengine') failCloudVoice(cause);
      else {
        resetVoice();
        Alert.alert('无法启动语音识别', cause instanceof Error ? cause.message : '请稍后重试。');
      }
    }
  };
  const stopVoice = () => {
    voiceStopRequested.current = true;
    if (voiceStarting.current) {
      voiceStartGeneration.current += 1;
      cloudSessionRef.current?.abort();
      cloudSessionRef.current = null;
      if (voiceSettings.asrProvider === 'system') {
        markSystemVoiceClosing();
        ExpoSpeechRecognitionModule.abort();
      }
      stopCloudAudio();
      resetVoice();
      return;
    }
    voiceTouchStartY.current = null;
    voiceCancelArmedRef.current = false;
    setVoiceCancelArmed(false);
    setVoiceStopping(true);
    if (voiceSettings.asrProvider === 'volcengine') {
      const session = cloudSessionRef.current;
      if (!session) {
        resetVoice();
        return;
      }
      stopCloudAudio();
      try {
        session.finish(pendingPcmRef.current ?? undefined);
        pendingPcmRef.current = null;
        clearVoiceFinishTimer();
        voiceFinishTimerRef.current = setTimeout(() => {
          failCloudVoice(new Error('火山 ASR 等待最终结果超时，请重试。'));
        }, 30_000);
      } catch (cause) {
        failCloudVoice(cause);
      }
      return;
    }
    ExpoSpeechRecognitionModule.stop();
  };
  const cancelVoice = () => {
    voiceStopRequested.current = true;
    voiceStartGeneration.current += 1;
    clearVoiceFinishTimer();
    cloudSessionRef.current?.abort();
    cloudSessionRef.current = null;
    if (voiceSettings.asrProvider === 'system') {
      markSystemVoiceClosing();
      ExpoSpeechRecognitionModule.abort();
    }
    stopCloudAudio();
    resetVoice();
  };
  const openNewSession = (nextDeviceId = deviceId, nextWorkspaceId = workspaceId) => {
    setDrawerOpen(false);
    router.push({
      pathname: '/new-session',
      params: { deviceId: nextDeviceId, workspaceId: nextWorkspaceId },
    });
  };
  const openDrawerSession = (next: MobileSession) => {
    rememberSession(next);
    setDrawerOpen(false);
    router.push({
      pathname: '/session/[sessionId]',
      params: {
        sessionId: next.sessionId,
        deviceId: next.deviceId,
        workspaceId: next.workspaceId,
        title: next.title,
        deviceName: next.deviceName,
        workspaceName: next.workspaceName,
        scopes: JSON.stringify(next.scopes),
      },
    });
  };
  const changeTab = (next: HomeTab) => {
    if (next !== 'sessions') router.navigate({ pathname: '/', params: { tab: next } });
  };
  const voiceActive = voiceMode && (voicePreparing || voiceListening || voiceStopping);
  const showSend = !voiceMode && (inputFocused || draft.trim().length > 0 || sending);
  const voiceActiveText = voiceCancelArmed
    ? '松开取消'
    : voicePreparing
      ? '正在准备语音识别…'
      : voiceStopping
        ? '正在完成语音转写…'
        : '松手完成，上移取消';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.page, { backgroundColor: theme.background }]}
    >
      <View style={{ paddingTop: insets.top }}>
        <View style={styles.head}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开会话侧边栏"
            hitSlop={10}
            onPress={() => setDrawerOpen(true)}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: theme.surface, borderColor: theme.border },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.iconText, { color: theme.text }]}>≡</Text>
          </Pressable>
          <View style={styles.headText}>
            <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
              {title}
            </Text>
            <Text numberOfLines={1} style={[styles.subtitle, { color: theme.textSecondary }]}>
              {[deviceName, workspaceName].filter(Boolean).join(' · ') || '已授权会话'}
            </Text>
          </View>
          {transcript?.active ? (
            <StatusBadge label="运行中" tone="accent" />
          ) : awaitingReply ? (
            <StatusBadge label="等待中" tone="warning" />
          ) : (
            <StatusBadge label="空闲" tone="neutral" />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="新建会话"
            hitSlop={8}
            onPress={() => openNewSession()}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: theme.surface, borderColor: theme.border },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.addIcon, { color: theme.accent }]}>＋</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="刷新对话"
            disabled={refreshing}
            hitSlop={8}
            onPress={() => void loadLatest('refresh')}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: theme.surface, borderColor: theme.border },
              pressed && styles.pressed,
            ]}
          >
            {refreshing ? (
              <ActivityIndicator color={theme.accent} size="small" />
            ) : (
              <Text style={[styles.refreshIcon, { color: theme.accent }]}>↻</Text>
            )}
          </Pressable>
          {canCancel && transcript?.active ? (
            <Pressable
              accessibilityRole="button"
              disabled={cancelling}
              onPress={cancel}
              style={({ pressed }) => [
                styles.stop,
                { borderColor: theme.danger, backgroundColor: theme.dangerSoft },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.stopText, { color: theme.danger }]}>
                {cancelling ? '停止中' : '停止'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {error ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void loadLatest('refresh')}
          style={[styles.error, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}
        >
          <Text style={[styles.errorText, { color: theme.warning }]}>{error}</Text>
          <Text style={[styles.errorAction, { color: theme.warning }]}>重试</Text>
        </Pressable>
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (stickToBottom.current) scrollRef.current?.scrollToEnd({ animated: false });
        }}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
          stickToBottom.current = distance < 120;
        }}
        scrollEventThrottle={100}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadLatest('refresh')}
            tintColor={theme.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {olderHasMore || older.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            disabled={!olderCursor || loadingOlder}
            onPress={() => void loadOlder()}
            style={({ pressed }) => [
              styles.older,
              { borderColor: theme.border, backgroundColor: theme.surface },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.olderText, { color: theme.accent }]}>
              {loadingOlder ? '正在加载…' : olderHasMore ? '加载更早消息' : '已到最早消息'}
            </Text>
          </Pressable>
        ) : null}

        {loading && !transcript ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.accent} />
            <Text style={[styles.loadingText, { color: theme.textSecondary }]}>正在读取对话…</Text>
          </View>
        ) : turns.length > 0 ? (
          turns.map((group, index) => {
            const running = index === runningIndex;
            return (
              <View key={group.key}>
                {group.user ? (
                  <MessageRow
                    attachmentAuth={attachmentAuth}
                    message={group.user}
                    state={
                      optimistic?.id === group.user.id
                        ? sending
                          ? 'sending'
                          : 'queued'
                        : undefined
                    }
                  />
                ) : null}
                <TurnCard
                  attachmentAuth={attachmentAuth}
                  group={group}
                  liveText={running ? streamText : ''}
                  now={nowTick}
                  running={running}
                />
              </View>
            );
          })
        ) : awaitingReply ? null : (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>还没有消息</Text>
            <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>
              这个会话可能是新建的，或者桌面还没有提交第一条内容。
            </Text>
          </View>
        )}

        {awaitingReply && !streamText && !runningHasContent ? (
          <View style={styles.messageRow}>
            <View
              style={[
                styles.bubble,
                styles.bubbleAssistant,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                  borderWidth: 1,
                  borderBottomLeftRadius: 6,
                },
              ]}
            >
              <View style={styles.waitingHead}>
                <ActivityIndicator color={theme.accent} size="small" />
                <Text style={[styles.waitingTitle, { color: theme.text }]}>{waitingTitle}</Text>
              </View>
              <Text style={[styles.waitingHint, { color: theme.textSecondary }]}>{waitingHint}</Text>
              {canRefreshManually ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="立即刷新对话"
                  onPress={() => void loadLatest('refresh')}
                  style={({ pressed }) => [styles.waitingAction, pressed && styles.pressed]}
                >
                  <Text style={[styles.waitingActionText, { color: theme.accent }]}>立即刷新</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {transcript?.truncated ? (
          <Text style={[styles.truncated, { color: theme.textSecondary }]}>
            消息过长，本次已截断显示；完整内容以桌面 DSH 为准。
          </Text>
        ) : null}
      </ScrollView>

      {sessionInteractions.length > 0 ? (
        <View>
          {sessionInteractions.map((interaction) => (
            <InteractionCard
              key={interaction.interactionId}
              interaction={interaction}
              busy={busyId === interaction.interactionId}
              onDecision={(decision) => {
                void decide(interaction, decision).catch((cause: unknown) => {
                  Alert.alert('提交失败', describeMobileApiError(cause));
                });
              }}
            />
          ))}
        </View>
      ) : null}

      {canPrompt ? (
        <View
          style={[
            styles.composer,
            {
              backgroundColor: theme.surface,
              paddingBottom: 10,
            },
          ]}
        >
          {voiceActive ? (
            <View pointerEvents="none" style={styles.voiceActivePanel}>
              <View style={[styles.voiceGlow, styles.voiceGlowOuter, { backgroundColor: voiceCancelArmed ? theme.danger : theme.accent }]} />
              <View style={[styles.voiceGlow, styles.voiceGlowMiddle, { backgroundColor: voiceCancelArmed ? theme.danger : theme.accent }]} />
              <View style={[styles.voiceGlow, styles.voiceGlowInner, { backgroundColor: voiceCancelArmed ? theme.danger : theme.accent }]} />
              <Text accessibilityLiveRegion="polite" style={[styles.voiceActiveText, { color: voiceCancelArmed ? theme.danger : theme.text }]}>
                {voiceActiveText}
              </Text>
              <View style={[styles.voiceWave, { opacity: voiceStopping ? 0.55 : 1 }]}>
                {VOICE_WAVE_BARS.map((height, index) => (
                  <View
                    key={index}
                    style={[styles.voiceWaveBar, { height, backgroundColor: voiceCancelArmed ? theme.danger : theme.accent }]}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <View style={[styles.composeBox, { backgroundColor: theme.surfaceMuted }, voiceActive && styles.composeBoxHidden]}>
            <View style={styles.voiceComposerRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={voiceMode ? '切换为键盘输入' : '切换为语音输入'}
                disabled={!voiceHydrated || !voiceSettings.enabled || voicePreparing || voiceListening || voiceStopping || systemVoiceClosing}
                onPress={() => setVoiceMode((current) => !current)}
                style={({ pressed }) => [
                  styles.voiceSwitch,
                  { backgroundColor: voiceMode ? theme.accentSoft : 'transparent', opacity: !voiceHydrated || !voiceSettings.enabled ? 0.45 : 1 },
                  pressed && styles.pressed,
                ]}
              >
                <ChatIcon name={voiceMode ? 'keyboard' : 'voice'} color={theme.accent} size={18} />
              </Pressable>
              {voiceMode ? (
                <View
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="按住说话，松手完成，上移取消"
                  accessibilityState={{ disabled: !voiceHydrated || !voiceSettings.enabled || voiceStopping || systemVoiceClosing, busy: voicePreparing || voiceStopping }}
                  onStartShouldSetResponder={() => voiceHydrated && voiceSettings.enabled && !voicePreparing && !voiceListening && !voiceStopping && !voiceStarting.current && systemVoiceGuard.canStart()}
                  onResponderTerminationRequest={() => false}
                  onResponderGrant={(event) => {
                    if (voicePreparing || voiceListening || voiceStopping || voiceStarting.current || !systemVoiceGuard.canStart()) return;
                    voiceTouchStartY.current = event.nativeEvent.pageY;
                    void startVoice();
                  }}
                  onResponderMove={(event) => {
                    const startY = voiceTouchStartY.current;
                    if (startY === null || voiceStopping) return;
                    const cancelArmed = shouldCancelVoiceGesture(startY, event.nativeEvent.pageY);
                    if (cancelArmed !== voiceCancelArmedRef.current) {
                      voiceCancelArmedRef.current = cancelArmed;
                      setVoiceCancelArmed(cancelArmed);
                    }
                  }}
                  onResponderRelease={() => {
                    if (voiceTouchStartY.current === null) return;
                    if (voiceCancelArmedRef.current) cancelVoice();
                    else stopVoice();
                  }}
                  onResponderTerminate={() => {
                    if (voiceTouchStartY.current !== null) cancelVoice();
                  }}
                  style={[styles.holdTalk, { backgroundColor: 'transparent' }]}
                >
                  <Text style={[styles.holdTalkText, { color: theme.text }]}>
                    {voicePreparing ? '正在准备…' : voiceStopping ? '正在转写…' : voiceListening ? '松手完成' : '按住说话'}
                  </Text>
                </View>
              ) : (
                <TextInput
                  accessibilityLabel="给 DSH 发送补充指令"
                  multiline
                  maxLength={32_000}
                  placeholder="发消息或按住说话…"
                  placeholderTextColor={theme.textSecondary}
                  value={draft}
                  onChangeText={setDraft}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  style={[styles.input, styles.voiceInput, { color: theme.text }]}
                />
              )}
              {showSend ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="发送"
                  disabled={!draft.trim() || sending || modelPending !== null}
                  onPress={() => void send()}
                  style={({ pressed }) => [styles.send, { backgroundColor: theme.accent, opacity: !draft.trim() || sending || modelPending !== null ? 0.4 : pressed ? 0.75 : 1 }]}
                >
                  {sending ? <ActivityIndicator color={theme.onAccent} size="small" /> : <Text style={[styles.sendText, { color: theme.onAccent }]}>↑</Text>}
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="更多输入选项"
                  onPress={openMoreOptions}
                  style={({ pressed }) => [styles.voiceSwitch, pressed && styles.pressed]}
                >
                  <Text style={[styles.moreOptionsText, { color: theme.textSecondary }]}>＋</Text>
                </Pressable>
              )}
            </View>
          </View>
          {!voiceMode && awaitingReply ? (
            <View style={styles.composeFoot}>
              <Text style={[styles.mode, { color: theme.textSecondary }]}>
                {transcript?.active ? '排队发送 · 桌面执行中' : '等待桌面响应…'}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View
          style={[
            styles.readOnly,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              paddingBottom: 10,
            },
          ]}
        >
          <Text style={[styles.readOnlyText, { color: theme.textSecondary }]}>
            当前授权只允许查看。若需要发送指令或停止执行，请让桌面在 DSH Connect 面板中补充对应动作。
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="查看会话模型"
            onPress={openModelSheet}
            style={({ pressed }) => [styles.readOnlyModelAction, { backgroundColor: theme.surfaceMuted }, pressed && styles.pressed]}
          >
            <Text style={[styles.readOnlyModelActionText, { color: theme.accent }]}>
              {modelCatalog ? `会话模型 · ${modelLabel(modelCatalog, modelCatalog.effective)}` : '查看会话模型'}
            </Text>
          </Pressable>
        </View>
      )}
      {voiceActive ? null : <TabBar active="sessions" onChange={changeTab} badge={interactions.length} />}
      <MoreOptionsSheet
        visible={moreOptionsOpen}
        catalog={modelCatalog}
        refreshing={modelRefreshing}
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
        pending={modelPending}
        canSelect={canPrompt}
        onClose={() => setModelSheetOpen(false)}
        onRefresh={refreshModel}
        onSelect={(selection) => { void selectModel(selection); }}
      />
      <SessionDrawer
        visible={drawerOpen}
        currentSessionId={sessionId}
        onClose={() => setDrawerOpen(false)}
        onCreateSession={openNewSession}
        onOpenSession={openDrawerSession}
      />
    </KeyboardAvoidingView>
  );
}

function MessageRow({
  message,
  state,
  streaming = false,
  attachmentAuth = null,
}: {
  message: MobileMessage;
  state?: 'sending' | 'queued';
  streaming?: boolean;
  attachmentAuth?: AttachmentAuth | null;
}) {
  const theme = useAppTheme();
  const { hydrated: voiceHydrated, speak, speakingKey } = useVoice();
  const user = message.role === 'user';
  const [expanded, setExpanded] = useState(false);
  const speaking = !user && speakingKey === messageKey(message);
  const collapsible = !streaming && message.text.length > 700;
  // Assistant replies are Markdown; collapse the plain-text preview so a long
  // answer stays scannable until the reader expands the formatted version.
  const preview = useMemo(
    () => (user ? message.text : markdownToPlainText(message.text)),
    [message.text, user],
  );
  const renderedAsMarkdown = !user && (!collapsible || expanded);
  const imageAttachments = useMemo(
    () => (message.attachments ?? []).filter((attachment) => attachment.kind === 'image'),
    [message.attachments],
  );
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const openAttachment = useCallback((attachmentId: string) => {
    const index = imageAttachments.findIndex((attachment) => attachment.attachmentId === attachmentId);
    if (index >= 0) setViewerIndex(index);
  }, [imageAttachments]);

  return (
    <View style={[styles.messageRow, user && styles.messageRowUser]}>
      <View
        style={[
          styles.bubble,
          !user && styles.bubbleAssistant,
          user
            ? { backgroundColor: theme.accent, borderBottomRightRadius: 6 }
            : { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderBottomLeftRadius: 6 },
        ]}
      >
        {renderedAsMarkdown ? (
          <MarkdownText
            streaming={streaming}
            text={message.text}
            attachments={message.attachments ?? []}
            attachmentAuth={attachmentAuth}
            onOpenAttachment={openAttachment}
          />
        ) : (
          <Text
            numberOfLines={collapsible && !expanded ? 14 : undefined}
            style={[styles.bubbleText, { color: user ? theme.onAccent : theme.text }]}
            selectable
          >
            {preview}
            {streaming ? ' ▍' : ''}
          </Text>
        )}
        <AttachmentGrid
          attachments={message.attachments ?? []}
          onOpen={(attachment) => openAttachment(attachment.attachmentId)}
        />
        {viewerIndex !== null ? (
          <AttachmentViewer
            attachments={imageAttachments}
            auth={attachmentAuth}
            initialIndex={viewerIndex}
            onClose={() => setViewerIndex(null)}
          />
        ) : null}
        {collapsible ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? '收起长消息' : '展开长消息'}
            onPress={() => setExpanded((current) => !current)}
            style={({ pressed }) => [styles.expandAction, pressed && styles.pressed]}
          >
            <Text style={[styles.expandText, { color: user ? theme.onAccent : theme.accent }]}>
              {expanded ? '收起' : `展开全文（${message.text.length} 字）`}
            </Text>
          </Pressable>
        ) : null}
        {state ? (
          <Text style={[styles.messageState, { color: theme.onAccent }]}>
            {state === 'sending' ? '发送中…' : '已排队'}
          </Text>
        ) : null}
        <View style={styles.messageFooter}>
          {!user ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={speaking ? '正在朗读回复' : '朗读回复'}
              accessibilityState={{ disabled: speaking || !voiceHydrated, busy: speaking }}
              disabled={speaking || !voiceHydrated}
              hitSlop={10}
              onPress={() => {
                void speak(preview, { key: messageKey(message) }).catch((cause: unknown) => {
                  Alert.alert('语音播报失败', cause instanceof Error ? cause.message : '请稍后重试。');
                });
              }}
              style={({ pressed }) => [
                styles.messageTts,
                speaking && { backgroundColor: theme.accentSoft },
                pressed && !speaking && styles.pressed,
              ]}
            >
              {/* Icon only: the label lives in accessibility so the footer stays compact.
                  While speaking the icon dims inside a soft pill, which keeps the
                  "busy / not pressable" signal the old 朗读中 text used to carry. */}
              <ChatIcon name="read" color={speaking ? theme.textSecondary : theme.accent} size={14} />
            </Pressable>
          ) : null}
          <Text
            style={[
              styles.messageTime,
              { color: user ? theme.onAccent : theme.textSecondary, opacity: user ? 0.7 : 1 },
            ]}
          >
            {streaming ? '流式接收中' : formatTime(message.occurredAt)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function messageKey(message: MobileMessage): string {
  return `message-${message.seq}`;
}

function isInjectedContext(text: string): boolean {
  const value = text.trimStart();
  return (
    value.startsWith('Time sampled while preparing') ||
    value.startsWith('Current runtime context.') ||
    value.startsWith('Browser time zone for this request') ||
    value.startsWith('Elapsed since the preceding') ||
    value.startsWith('<system-reminder>') ||
    value.startsWith('The available skill catalog changed')
  );
}

function parseScopes(value: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function single(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 25,
    lineHeight: 27,
    marginTop: -3,
  },
  addIcon: {
    fontSize: 21,
    lineHeight: 23,
    fontWeight: '600',
  },
  refreshIcon: {
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '600',
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: Typography.reading,
    lineHeight: 22,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: Typography.caption,
    lineHeight: 18,
  },
  stop: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  stopText: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '700',
  },
  error: {
    marginHorizontal: 16,
    marginBottom: 6,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    flex: 1,
    fontSize: Typography.secondary,
    lineHeight: 20,
  },
  errorAction: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '700',
  },
  messages: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 18,
    gap: 12,
  },
  older: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginBottom: 6,
  },
  olderText: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '600',
  },
  loading: {
    paddingVertical: 50,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: Typography.body,
    lineHeight: 20,
  },
  empty: {
    paddingVertical: 40,
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
    maxWidth: 300,
  },
  truncated: {
    fontSize: Typography.caption,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
  },
  messageRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '84%',
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 5,
  },
  // Assistant replies own the whole message column so long Markdown does not
  // leave an empty strip on the right; user bubbles stay content-sized.
  bubbleAssistant: {
    flex: 1,
    maxWidth: '100%',
  },
  bubbleText: {
    fontSize: Typography.reading,
    lineHeight: 24,
  },
  expandAction: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  expandText: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '700',
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    minHeight: 24,
  },
  messageTime: {
    fontSize: Typography.caption,
    lineHeight: 17,
    marginLeft: 'auto',
  },
  messageState: {
    fontSize: Typography.caption,
    lineHeight: 18,
    alignSelf: 'flex-end',
    opacity: 0.75,
  },
  messageTts: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginLeft: -4,
    borderRadius: 8,
  },
  waitingHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  waitingTitle: {
    flex: 1,
    fontSize: Typography.control,
    lineHeight: 21,
    fontWeight: '600',
  },
  waitingHint: {
    fontSize: Typography.secondary,
    lineHeight: 20,
  },
  waitingAction: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  waitingActionText: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '700',
  },
  composer: {
    position: 'relative',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  composeBox: {
    borderRadius: 27,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  composeBoxHidden: {
    opacity: 0,
  },
  input: {
    minHeight: 38,
    maxHeight: 120,
    fontSize: Typography.reading,
    lineHeight: 24,
    paddingHorizontal: 4,
    paddingVertical: 5,
  },
  composeFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  mode: {
    fontSize: Typography.caption,
    lineHeight: 18,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '600',
  },
  voiceComposerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  voiceSwitch: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreOptionsText: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '500',
  },
  voiceInput: {
    flex: 1,
  },
  holdTalk: {
    flex: 1,
    minHeight: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdTalkText: {
    fontSize: Typography.control,
    lineHeight: 22,
    fontWeight: '600',
  },
  voiceActivePanel: {
    position: 'absolute',
    zIndex: 2,
    left: 0,
    right: 0,
    bottom: 0,
    height: 220,
    alignItems: 'center',
    paddingTop: 66,
  },
  voiceGlow: {
    position: 'absolute',
    bottom: -120,
    width: 260,
    height: 210,
    borderRadius: 130,
    transform: [{ scaleX: 1.45 }],
  },
  voiceGlowOuter: {
    bottom: -100,
    width: 300,
    height: 230,
    opacity: 0.06,
  },
  voiceGlowMiddle: {
    bottom: -110,
    width: 270,
    height: 210,
    opacity: 0.1,
  },
  voiceGlowInner: {
    width: 230,
    height: 190,
    opacity: 0.16,
  },
  voiceActiveText: {
    fontSize: Typography.control,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  voiceWave: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 22,
  },
  voiceWaveBar: {
    width: 4,
    borderRadius: 2,
  },
  readOnly: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  readOnlyText: {
    fontSize: Typography.secondary,
    lineHeight: 20,
    textAlign: 'center',
  },
  readOnlyModelAction: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 10,
  },
  readOnlyModelActionText: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
});
