import {
  HarmonyFileExportNative,
  type HarmonyFileExportResult,
} from '../../modules/harmony-file-export';
import { sanitizeAttachmentFileName } from '@/lib/attachment-file-name';

export async function saveOriginalAttachment(
  sourceUri: string,
  attachmentName: string,
): Promise<HarmonyFileExportResult> {
  const result = await HarmonyFileExportNative.save(
    sourceUri,
    sanitizeAttachmentFileName(attachmentName),
  );
  if (result === 'saved' || result === 'cancelled') return result;
  throw new Error('原生附件保存模块返回了无法识别的结果。');
}
