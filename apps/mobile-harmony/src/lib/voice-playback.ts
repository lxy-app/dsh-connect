export type VoicePlaybackStatus = 'preparing' | 'playing' | 'paused';

export type VoicePlayback = {
  /** Null is used by ad-hoc previews that do not belong to a chat message. */
  key: string | null;
  status: VoicePlaybackStatus;
  provider: 'system' | 'volcengine';
  /** Android system TTS cannot pause through expo-speech and offers stop instead. */
  canPause: boolean;
};

export type VoiceControlAction = 'start' | 'cancel' | 'pause' | 'resume' | 'stop';

/** Harmony M0 uses continuous MP3 files because short WAV playlist items have audible gaps. */
export function shouldUseStreamingPcm(platform: string): boolean {
  return platform !== 'web' && platform !== 'harmony';
}

export function voiceControlAction(playback: VoicePlayback | null, key: string): VoiceControlAction {
  if (!playback || playback.key !== key) return 'start';
  if (playback.status === 'preparing') return 'cancel';
  if (playback.status === 'paused') return 'resume';
  return playback.canPause ? 'pause' : 'stop';
}

export function voicePlaybackStatusFromAudio(
  status: { playing: boolean; timeControlStatus: string },
  current: VoicePlaybackStatus | null,
): VoicePlaybackStatus | null {
  if (status.playing) return 'playing';
  // iOS reports rate == 0 while waiting to play too. Only an explicit paused
  // time-control event may transition an already playing item to paused.
  if (status.timeControlStatus === 'paused' && current === 'playing') return 'paused';
  return null;
}
