import { requireOptionalNativeModule } from 'expo-modules-core';

export type HarmonyAttachmentPickerSource = 'camera' | 'library' | 'document';

type HarmonyAttachmentPickerNativeModule = {
  readonly platform: 'harmony';
  /** Returns a JSON envelope; parsing and validation stay in the testable JS adapter. */
  pick(source: HarmonyAttachmentPickerSource, remainingSlots: number): Promise<string>;
};

const nativeModule = requireOptionalNativeModule<HarmonyAttachmentPickerNativeModule>('HarmonyAttachmentPicker');

export const HarmonyAttachmentPickerNative = {
  isAvailable: nativeModule !== null,
  async pick(source: HarmonyAttachmentPickerSource, remainingSlots: number): Promise<string> {
    if (!nativeModule) {
      throw new Error('当前鸿蒙原生包未包含附件选择模块，请重新构建并安装应用。');
    }
    return nativeModule.pick(source, remainingSlots);
  },
};
