import { ActivityIndicator, Alert, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ChatIcon } from '@/components/chat-icon';
import { useAppTheme } from '@/hooks/use-app-theme';
import { voiceControlAction, type VoiceControlAction } from '@/lib/voice-playback';
import { useVoice } from '@/providers/voice-provider';

const ACTION_LABELS: Record<VoiceControlAction, string> = {
  start: '朗读回复',
  cancel: '取消朗读准备',
  pause: '暂停朗读',
  resume: '继续朗读',
  stop: '停止朗读',
};

export function ReadAloudButton({
  text,
  playbackKey,
  style,
  disabled = false,
}: {
  text: string;
  playbackKey: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  const {
    hydrated,
    playback,
    speak,
    pauseSpeaking,
    resumeSpeaking,
    stopSpeaking,
  } = useVoice();
  const action = voiceControlAction(playback, playbackKey);
  const active = action !== 'start';

  const run = async () => {
    if (action === 'cancel' || action === 'stop') {
      await stopSpeaking();
      return;
    }
    if (action === 'pause') {
      await pauseSpeaking();
      return;
    }
    if (action === 'resume') {
      await resumeSpeaking();
      return;
    }
    await speak(text, { key: playbackKey });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ACTION_LABELS[action]}
      accessibilityState={{ disabled: !hydrated || disabled, busy: action === 'cancel' }}
      disabled={!hydrated || disabled}
      hitSlop={10}
      onPress={() => {
        void run().catch((cause: unknown) => {
          Alert.alert('语音播报失败', cause instanceof Error ? cause.message : '请稍后重试。');
        });
      }}
      style={({ pressed }) => [
        styles.button,
        style,
        active && { backgroundColor: theme.accentSoft },
        (pressed || disabled) && styles.pressed,
      ]}
    >
      {action === 'cancel' ? (
        <ActivityIndicator color={theme.accent} size={14} />
      ) : action === 'pause' || action === 'resume' || action === 'stop' ? (
        <PlaybackControlIcon action={action} color={theme.accent} />
      ) : (
        <ChatIcon name="read" color={theme.accent} size={14} />
      )}
    </Pressable>
  );
}

function PlaybackControlIcon({ action, color }: { action: 'pause' | 'resume' | 'stop'; color: string }) {
  if (action === 'resume') {
    return <View style={[styles.play, { borderLeftColor: color }]} />;
  }
  if (action === 'stop') {
    return <View style={[styles.stop, { backgroundColor: color }]} />;
  }
  return (
    <View style={styles.pause}>
      <View style={[styles.pauseBar, { backgroundColor: color }]} />
      <View style={[styles.pauseBar, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 24,
    minHeight: 24,
    borderRadius: 7,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.45 },
  pause: { height: 14, flexDirection: 'row', alignItems: 'center', gap: 3 },
  pauseBar: { width: 3, height: 12, borderRadius: 1.5 },
  play: {
    width: 0,
    height: 0,
    marginLeft: 2,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 11,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  stop: { width: 10, height: 10, borderRadius: 2 },
});
