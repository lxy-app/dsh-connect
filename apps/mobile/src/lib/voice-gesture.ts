export const VOICE_CANCEL_DISTANCE_PX = 56;

export function shouldCancelVoiceGesture(startY: number, currentY: number): boolean {
  return currentY < startY - VOICE_CANCEL_DISTANCE_PX;
}
