import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { RECORDING_AUDIO_MODE } from '@/lib/audio-session';
import { SystemVoiceSessionGuard } from '@/lib/system-voice-session';
import { openVolcAsrSession, type VolcAsrSession } from '@/lib/volc-asr';
import { useVoice } from '@/providers/voice-provider';
import { HARMONY_AUDIO_STREAM_UNAVAILABLE, useAudioStream } from '@/shims/expo-audio-stream';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from '@/shims/expo-speech-recognition';

export function useVoiceTranscription(onTranscript: (text: string) => void) {
  const { settings, hydrated: voiceHydrated, pauseSpeaking, restorePlaybackAudioMode } = useVoice();
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
  const voiceEventsActive = useRef(true);
  useFocusEffect(useCallback(() => {
    voiceEventsActive.current = true;
    return () => { voiceEventsActive.current = false; };
  }, []));

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
    void restorePlaybackAudioMode().catch(() => undefined);
  }, [restorePlaybackAudioMode]);
  const finishCloudVoice = useCallback((text: string) => {
    clearVoiceFinishTimer();
    cloudSessionRef.current = null;
    stopCloudAudio();
    resetVoice();
    const transcript = text.trim();
    if (transcript) onTranscript(transcript);
  }, [clearVoiceFinishTimer, onTranscript, resetVoice, stopCloudAudio]);
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
    onError: (cause) => {
      if (cloudSessionRef.current) failCloudVoice(cause);
    },
  });
  useEffect(() => {
    audioStreamStopRef.current = () => audioStream?.stop();
  }, [audioStream]);

  useSpeechRecognitionEvent('start', () => {
    if (!voiceEventsActive.current) return;
    if (settings.asrProvider !== 'system' || systemVoiceGuard.isClosing()) return;
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
    if (!voiceEventsActive.current) return;
    if (settings.asrProvider !== 'system' || systemVoiceGuard.isClosing()) return;
    const text = event.results[0]?.transcript?.trim() ?? '';
    if (!text) return;
    voiceTextRef.current = text;
  });
  useSpeechRecognitionEvent('end', () => {
    if (!voiceEventsActive.current) return;
    if (settings.asrProvider !== 'system') return;
    if (systemVoiceGuard.consumeTerminalEnd()) {
      // Native events have no session ID. Consume the cancelled/failed session's
      // terminal end before allowing another recording to start.
      setSystemVoiceClosing(false);
      voiceTextRef.current = '';
      return;
    }
    const text = voiceTextRef.current.trim();
    resetVoice();
    if (text) onTranscript(text);
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (!voiceEventsActive.current) return;
    if (settings.asrProvider !== 'system') return;
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

  const startCloudVoice = async (generation: number) => {
    if (Platform.OS === 'web') throw new Error('浏览器无法传递火山 ASR 所需的 WebSocket 鉴权头，请改用系统 ASR 或移动端 Development Build。');
    if (!audioStream.isSupported) throw new Error(HARMONY_AUDIO_STREAM_UNAVAILABLE);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error('请允许麦克风权限后重试。');
    if (generation !== voiceStartGeneration.current || voiceStopRequested.current) return;

    let session: VolcAsrSession;
    session = openVolcAsrSession(
      { apiKey: settings.apiKey, endpoint: settings.endpoint, protocol: settings.asrProtocol },
      {
        onOpen: () => {
          void (async () => {
            try {
              if (generation !== voiceStartGeneration.current || voiceStopRequested.current) {
                session.abort();
                return;
              }
              audioStreamOwnerRef.current = generation;
              await setAudioModeAsync(RECORDING_AUDIO_MODE);
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
    if (!voiceHydrated || !settings.enabled || voiceListening || voiceStarting.current || !systemVoiceGuard.canStart()) return;
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
      // Recording owns the audio session; keep a cloud reply paused so it can
      // resume from the same position after the user finishes speaking.
      await pauseSpeaking({ forRecording: true });
      if (generation !== voiceStartGeneration.current || voiceStopRequested.current) return;
      if (settings.asrProvider === 'volcengine') {
        await startCloudVoice(generation);
        return;
      }
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        throw new Error('请启用系统语音识别服务后重试。');
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) throw new Error('请允许麦克风和系统语音识别权限后重试。');
      if (generation !== voiceStartGeneration.current || voiceStopRequested.current) return;
      ExpoSpeechRecognitionModule.start({ lang: settings.language, interimResults: true, continuous: false, maxAlternatives: 1 });
    } catch (cause) {
      if (generation !== voiceStartGeneration.current) return;
      if (settings.asrProvider === 'volcengine') failCloudVoice(cause);
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
      if (settings.asrProvider === 'system') {
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
    if (settings.asrProvider === 'volcengine') {
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
    if (settings.asrProvider === 'system') {
      markSystemVoiceClosing();
      ExpoSpeechRecognitionModule.abort();
    }
    stopCloudAudio();
    resetVoice();
  };

  const voiceEnabled = voiceHydrated && settings.enabled;
  const voiceActive = voiceMode && (voicePreparing || voiceListening || voiceStopping);
  const voiceActiveText = voiceCancelArmed
    ? '松开取消'
    : voicePreparing
      ? '正在准备语音识别…'
      : voiceStopping
        ? '正在完成语音转写…'
        : '松手完成，上移取消';

  return {
    voiceMode,
    setVoiceMode,
    voicePreparing,
    voiceListening,
    voiceStopping,
    voiceCancelArmed,
    setVoiceCancelArmed,
    systemVoiceClosing,
    systemVoiceGuard,
    voiceStarting,
    voiceTouchStartY,
    voiceCancelArmedRef,
    startVoice,
    stopVoice,
    cancelVoice,
    voiceEnabled,
    voiceActive,
    voiceActiveText,
  };
}
