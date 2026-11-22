import { requireOptionalNativeModule } from 'expo-modules-core';

export type HarmonyFileExportResult = 'saved' | 'cancelled';

type HarmonyFileExportNativeModule = {
  readonly platform: 'harmony';
  save(sourceUri: string, suggestedName: string): Promise<HarmonyFileExportResult>;
};

const nativeModule = requireOptionalNativeModule<HarmonyFileExportNativeModule>('HarmonyFileExport');

export const HarmonyFileExportNative = {
  isAvailable: nativeModule !== null,
  async save(sourceUri: string, suggestedName: string): Promise<HarmonyFileExportResult> {
    if (!nativeModule) {
      throw new Error('当前鸿蒙原生包未包含附件保存模块，请重新构建应用。');
    }
    return nativeModule.save(sourceUri, suggestedName);
  },
};
