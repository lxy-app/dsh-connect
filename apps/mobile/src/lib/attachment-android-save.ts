import type { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';

import {
  attachmentFileStem,
  attachmentMimeType,
  attachmentNameFromSafUri,
  nextAvailableAttachmentFileName,
  savedFileHasExpectedBytes,
} from '@/lib/attachment-save-utils';
import type { MobileAttachment } from '@shared/types/mobile';

const { StorageAccessFramework } = FileSystem;

export type AndroidAttachmentSaveResult =
  | { readonly status: 'saved'; readonly fileName: string }
  | { readonly status: 'cancelled' };

export class AndroidAttachmentSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AndroidAttachmentSaveError';
  }
}

/** Creates and verifies a real SAF document; no share intent is involved. */
export async function saveOriginalFileToAndroid(
  source: File,
  attachment: MobileAttachment,
): Promise<AndroidAttachmentSaveResult> {
  let permissions: FileSystem.FileSystemRequestDirectoryPermissionsResult;
  try {
    permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  } catch {
    throw new AndroidAttachmentSaveError('无法打开系统目录选择器，请重试。');
  }
  if (!permissions.granted) return { status: 'cancelled' };

  let outputUri: string | null = null;
  try {
    const existingUris = await StorageAccessFramework.readDirectoryAsync(permissions.directoryUri);
    const existingNames = new Set(
      existingUris
        .map(attachmentNameFromSafUri)
        .filter((name): name is string => name !== null),
    );
    const requestedName = nextAvailableAttachmentFileName(attachment.name, existingNames);
    const mimeType = attachmentMimeType(attachment);
    // createFileAsync/DocumentsContract creates rather than overwrites. If another
    // writer wins the name race, the provider may add its own numeric suffix.
    outputUri = await StorageAccessFramework.createFileAsync(
      permissions.directoryUri,
      attachmentFileStem(requestedName),
      mimeType,
    );

    const base64 = await source.base64();
    await StorageAccessFramework.writeAsStringAsync(outputUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const outputInfo = await FileSystem.getInfoAsync(outputUri);
    if (!savedFileHasExpectedBytes(outputInfo, source.size)) {
      throw new AndroidAttachmentSaveError('本地文件校验失败，未确认完整保存。');
    }
    return {
      status: 'saved',
      fileName: attachmentNameFromSafUri(outputUri) ?? requestedName,
    };
  } catch (error) {
    if (outputUri) {
      try {
        await StorageAccessFramework.deleteAsync(outputUri, { idempotent: true });
      } catch {
        // Preserve the write/verification failure; a partial document is never reported as saved.
      }
    }
    if (error instanceof AndroidAttachmentSaveError) throw error;
    throw new AndroidAttachmentSaveError('未能写入所选目录，请检查目录权限与可用存储后重试。');
  }
}
