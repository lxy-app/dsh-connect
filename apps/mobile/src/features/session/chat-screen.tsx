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
import { SessionDrawer } from '@/features/navigation/session-drawer';
import { TabBar, type HomeTab } from '@/components/tab-bar';
import { MarkdownText } from '@/components/markdown';
import { StatusBadge } from '@/components/status-badge';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
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
import { openSessionStream } from '@/lib/session-stream';
import { openVolcAsrSession, type VolcAsrSession } from '@/lib/volc-asr';
import { useInteractions } from '@/providers/interactions-provider';
import { useMobileSession } from '@/providers/mobile-session-provider';
import { useVoice } from '@/providers/voice-provider';
import type { MobileMessage, MobileSession, MobileTranscript } from '@/types/mobile';

export function ChatScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { authorized, session, connection, rememberSession } = useMobileSession();
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStopping, setVoiceStopping] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const voiceTextRef = useRef('');
  const voiceStopRequested = useRef(false);
  const voiceStarting = useRef(false);
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
  const [streaming, setStreaming] = useState(false);
  const inflight = useRef(false);
  const cursorInitialized = useRef(false);
  const latestSeqRef = useRef(0);
  const streamClearAfter = useRef(0);
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const stickToBottom = useRef(true);

  const resetVoice = useCallback(() => {
    voiceStarting.current = false;
    setVoiceListening(false);
    setVoiceStopping(false);
    setVoiceMode(false);
    setVoiceTranscript('');
    voiceTextRef.current = '';
    pendingPcmRef.current = null;
  }, []);
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
    if (voiceSettings.asrProvider !== 'system') return;
    if (voiceStopRequested.current) {
      ExpoSpeechRecognitionModule.abort();
      resetVoice();
      return;
    }
    voiceStarting.current = false;
    setVoiceListening(true);
    setVoiceStopping(false);
  });
  useSpeechRecognitionEvent('result', (event) => {
    if (voiceSettings.asrProvider !== 'system') return;
    const text = event.results[0]?.transcript?.trim() ?? '';
    if (!text) return;
    voiceTextRef.current = text;
    setVoiceTranscript(text);
  });
  useSpeechRecognitionEvent('end', () => {
    if (voiceSettings.asrProvider !== 'system') return;
    const text = voiceTextRef.current.trim();
    resetVoice();
    if (text) setDraft((current) => `${current.trim() ? `${current.trim()}\n` : ''}${text}`);
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (voiceSettings.asrProvider !== 'system') return;
    resetVoice();
    if (event.error !== 'aborted') Alert.alert('语音识别未完成', event.message || '请检查麦克风权限和系统语音识别服务后重试。');
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
          setStreaming(false);
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
  const shouldStream = Boolean(
    session && (sending || pendingReply !== null || transcript?.active === true),
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
            onStart: () => setStreaming(true),
            onDelta: (text) => {
              setStreaming(true);
              setStreamText((currentText) => currentText + text);
            },
            onEnd: () => {
              setStreaming(false);
              void loadLatest('silent');
            },
            onRefresh: () => {
              void loadLatest('silent');
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
    () => messages.filter(
      (message) => message.role !== 'tool'
        && !(message.role === 'user' && isInjectedContext(message.text)),
    ),
    [messages],
  );
  const hiddenToolCount = messages.filter((message) => message.role === 'tool').length;

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
  const canRefreshManually = awaitingReply && (waitSeconds >= 6 || error !== null);
  useEffect(() => {
    const latest = [...conversation].reverse().find((message) => message.role === 'assistant');
    if (!latest) return;
    if (!speechInitialized.current) {
      speechInitialized.current = true;
      lastSpokenSeq.current = latest.seq;
      return;
    }
    if (latest.seq === lastSpokenSeq.current) return;
    lastSpokenSeq.current = latest.seq;
    if (voiceHydrated && voiceSettings.autoPlay && !transcript?.active && !streamText) {
      void speak(markdownToPlainText(latest.text)).catch((cause: unknown) => {
        Alert.alert('语音播报失败', cause instanceof Error ? cause.message : '请稍后重试。');
      });
    }
  }, [conversation, speak, streamText, transcript?.active, voiceHydrated, voiceSettings.autoPlay]);

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
    if (!text || sending || !canPrompt) return;
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
          setVoiceTranscript(text);
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
    if (!voiceHydrated || !voiceSettings.enabled || voiceListening || voiceStarting.current) return;
    const generation = ++voiceStartGeneration.current;
    voiceStarting.current = true;
    voiceTextRef.current = '';
    pendingPcmRef.current = null;
    voiceStopRequested.current = false;
    clearVoiceFinishTimer();
    setVoiceTranscript('');
    setVoiceStopping(false);
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
      ExpoSpeechRecognitionModule.abort();
      stopCloudAudio();
      resetVoice();
      return;
    }
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
        ) : conversation.length > 0 ? (
          conversation.map((message) => (
            <MessageRow
              key={`${message.seq}-${message.id}`}
              message={message}
              state={
                optimistic?.id === message.id
                  ? sending
                    ? 'sending'
                    : 'queued'
                  : undefined
              }
            />
          ))
        ) : awaitingReply ? null : (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>还没有消息</Text>
            <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>
              这个会话可能是新建的，或者桌面还没有提交第一条内容。
            </Text>
          </View>
        )}

        {streamText ? (
          <MessageRow
            key="live-stream"
            streaming={streaming}
            message={{
              id: 'live-stream',
              seq: Number.MAX_SAFE_INTEGER,
              role: 'assistant',
              text: streamText,
              occurredAt: new Date().toISOString(),
            }}
          />
        ) : null}

        {awaitingReply && !streamText ? (
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

        {hiddenToolCount > 0 ? (
          <Text style={[styles.hiddenTools, { color: theme.textSecondary }]}>
            已省略 {hiddenToolCount} 个工具调用与输出，仅显示对话内容。
          </Text>
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
              borderColor: theme.border,
              paddingBottom: 10,
            },
          ]}
        >
          <View style={styles.composeBox}>
            {voiceMode ? (
              <View style={[styles.voiceFeedback, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}>
                <Text style={[styles.voiceFeedbackTitle, { color: theme.text }]}>
                  {voiceListening ? '正在聆听，请开始说话' : voiceStopping ? '正在完成语音转写…' : '准备语音识别'}
                </Text>
                <Text style={[styles.voiceTranscript, { color: theme.textSecondary }]}>{voiceTranscript || '松开完成，识别结果会回填到输入框'}</Text>
              </View>
            ) : null}
            <View style={styles.voiceComposerRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={voiceMode ? '切换为键盘输入' : '切换为语音输入'}
                disabled={!voiceHydrated || !voiceSettings.enabled || voiceListening}
                onPress={() => setVoiceMode((current) => !current)}
                style={[styles.voiceSwitch, { backgroundColor: voiceMode ? theme.accentSoft : theme.surfaceMuted }]}
              >
                <Text style={[styles.voiceSwitchText, { color: theme.accent }]}>{voiceMode ? '⌨' : '◉'}</Text>
              </Pressable>
              {voiceMode ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="按住说话"
                  disabled={!voiceHydrated || !voiceSettings.enabled || voiceStopping}
                  onPressIn={() => void startVoice()}
                  onPressOut={stopVoice}
                  style={({ pressed }) => [styles.holdTalk, { backgroundColor: voiceListening || pressed ? theme.accent : theme.accentSoft }]}
                >
                  <Text style={[styles.holdTalkText, { color: voiceListening ? theme.onAccent : theme.accent }]}>{voiceListening ? '松开完成' : voiceStopping ? '正在转写…' : '按住说话'}</Text>
                </Pressable>
              ) : (
                <TextInput
                  accessibilityLabel="给 DSH 发送补充指令"
                  multiline
                  maxLength={32_000}
                  placeholder="发消息或按住说话…"
                  placeholderTextColor={theme.textSecondary}
                  value={draft}
                  onChangeText={setDraft}
                  style={[styles.input, styles.voiceInput, { color: theme.text }]}
                />
              )}
              {!voiceMode ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="发送"
                  disabled={!draft.trim() || sending}
                  onPress={() => void send()}
                  style={({ pressed }) => [styles.send, { backgroundColor: theme.accent, opacity: !draft.trim() || sending ? 0.4 : pressed ? 0.75 : 1 }]}
                >
                  {sending ? <ActivityIndicator color={theme.onAccent} size="small" /> : <Text style={[styles.sendText, { color: theme.onAccent }]}>发送</Text>}
                </Pressable>
              ) : null}
            </View>
            <View style={styles.composeFoot}>
              <Text style={[styles.mode, { color: theme.textSecondary }]}>
                {voiceMode ? '按住说话，松开完成转写' : transcript?.active ? '排队发送 · 桌面执行中' : awaitingReply ? '等待桌面响应…' : '排队发送'}
              </Text>
            </View>
          </View>
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
        </View>
      )}
      <TabBar active="sessions" onChange={changeTab} badge={interactions.length} />
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
}: {
  message: MobileMessage;
  state?: 'sending' | 'queued';
  streaming?: boolean;
}) {
  const theme = useAppTheme();
  const { hydrated: voiceHydrated, speak } = useVoice();
  const user = message.role === 'user';
  const [expanded, setExpanded] = useState(false);
  const collapsible = !streaming && message.text.length > 700;
  // Assistant replies are Markdown; collapse the plain-text preview so a long
  // answer stays scannable until the reader expands the formatted version.
  const preview = useMemo(
    () => (user ? message.text : markdownToPlainText(message.text)),
    [message.text, user],
  );
  const renderedAsMarkdown = !user && (!collapsible || expanded);

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
          <MarkdownText streaming={streaming} text={message.text} />
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
        <Text
          style={[
            styles.messageTime,
            { color: user ? theme.onAccent : theme.textSecondary, opacity: user ? 0.7 : 1 },
          ]}
        >
          {streaming ? '流式接收中' : formatTime(message.occurredAt)}
        </Text>
        {!user ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="朗读回复"
            disabled={!voiceHydrated}
            onPress={() => {
              void speak(markdownToPlainText(message.text)).catch((cause: unknown) => {
                Alert.alert('语音播报失败', cause instanceof Error ? cause.message : '请稍后重试。');
              });
            }}
            style={styles.messageTts}
          >
            <Text style={[styles.messageTtsText, { color: theme.accent }]}>▷ 朗读</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
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
  hiddenTools: {
    fontSize: Typography.caption,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
  },
  messageTime: {
    fontSize: Typography.caption,
    lineHeight: 18,
    alignSelf: 'flex-end',
  },
  messageState: {
    fontSize: Typography.caption,
    lineHeight: 18,
    alignSelf: 'flex-end',
    opacity: 0.75,
  },
  messageTts: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  messageTtsText: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '600',
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
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  composeBox: {
    gap: 6,
  },
  input: {
    minHeight: 40,
    maxHeight: 120,
    fontSize: Typography.reading,
    lineHeight: 24,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  composeFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mode: {
    fontSize: Typography.caption,
    lineHeight: 18,
  },
  send: {
    minWidth: 62,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  sendText: {
    fontSize: Typography.control,
    lineHeight: 21,
    fontWeight: '700',
  },
  voiceComposerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  voiceSwitch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceSwitchText: {
    fontSize: 16,
    fontWeight: '700',
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
    fontWeight: '700',
  },
  voiceFeedback: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 11,
    gap: 6,
  },
  voiceFeedbackTitle: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '600',
  },
  voiceTranscript: {
    fontSize: Typography.body,
    lineHeight: 21,
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
  pressed: {
    opacity: 0.6,
  },
});
