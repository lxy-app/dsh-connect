import type { AudioMode } from 'expo-audio';

/** Keep recording and playback from leaving conflicting global audio flags behind. */
export const PLAYBACK_AUDIO_MODE: Partial<AudioMode> = {
  allowsRecording: false,
  allowsBackgroundRecording: false,
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: 'doNotMix',
};

export const RECORDING_AUDIO_MODE: Partial<AudioMode> = {
  allowsRecording: true,
  allowsBackgroundRecording: false,
  playsInSilentMode: true,
  shouldPlayInBackground: false,
  interruptionMode: 'doNotMix',
};
