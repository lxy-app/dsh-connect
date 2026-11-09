import { splitTextForSpeech } from '@shared/lib/speech-segments';

/** 鸿蒙当前优先保证连续播放；其他平台沿用共享的首段快速出声策略。 */
export function speechSegmentsForPlatform(text: string, platform: string): string[] {
  if (platform === 'harmony') {
    const normalized = text.trim();
    return normalized ? [normalized] : [];
  }
  return splitTextForSpeech(text);
}
