/**
 * M0 鸿蒙可行性验证用的兜底实现。
 * expo-speech-recognition 没有鸿蒙移植，这里提供空实现，
 * 使聊天页的语音输入按钮在鸿蒙上不崩溃，并明确报告能力不可用。
 * 正式方案需要自研 ArkTS 模块或改走火山 ASR。
 */

export type ExpoSpeechRecognitionResultEvent = {
  results: { transcript: string; confidence: number }[];
  isFinal: boolean;
};

export const ExpoSpeechRecognitionModule = {
  isRecognitionAvailable() {
    return false;
  },
  async requestPermissionsAsync() {
    return { granted: false, status: 'denied', canAskAgain: false, expires: 'never' as const };
  },
  getPermissionsAsync() {
    return Promise.resolve({ granted: false, status: 'denied', canAskAgain: false, expires: 'never' as const });
  },
  async getSupportedLocales() {
    return { locales: [], installedLocales: [] };
  },
  start(_options?: {
    lang?: string;
    interimResults?: boolean;
    continuous?: boolean;
    maxAlternatives?: number;
  }) {},
  stop() {},
  abort() {},
  addListener() {
    return { remove() {} };
  },
  removeAllListeners() {},
};

export function useSpeechRecognitionEvent(_event: string, _handler: (event: any) => void) {
  // no-op on HarmonyOS
}

export default { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent };
