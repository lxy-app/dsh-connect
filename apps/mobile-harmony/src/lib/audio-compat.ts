import type { AudioMetadata, AudioPlayer, AudioPlaylist } from 'expo-audio';

type LockScreenCapable = Partial<Pick<AudioPlayer, 'setActiveForLockScreen' | 'clearLockScreenControls'>>;

/** SDK 55 AudioPlaylist has no lock-screen methods; AudioPlayer does. */
export function activateAudioLockScreen(target: AudioPlayer | AudioPlaylist, metadata: AudioMetadata): void {
  const capable = target as unknown as LockScreenCapable;
  capable.setActiveForLockScreen?.(true, metadata, {
    showSeekForward: false,
    showSeekBackward: false,
  });
}

export function clearAudioLockScreen(target: AudioPlayer | AudioPlaylist): void {
  const capable = target as unknown as LockScreenCapable;
  capable.clearLockScreenControls?.();
}

/** SDK 58 exposes playback errors on AudioStatus; SDK 55 does not declare them. */
export function audioStatusError(status: object): string | null {
  const error = (status as { error?: unknown }).error;
  return typeof error === 'string' && error.length > 0 ? error : null;
}
