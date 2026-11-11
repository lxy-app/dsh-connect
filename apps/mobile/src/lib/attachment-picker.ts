import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { createAttachmentDraft, type PromptAttachmentDraft } from '@shared/lib/prompt-attachments';

/** How the user asked for attachments: the composer "更多" sheet has one tile each. */
export type AttachmentSource = 'camera' | 'library' | 'document';

export type AttachmentPickResult =
  | { readonly kind: 'picked'; readonly drafts: readonly PromptAttachmentDraft[] }
  | { readonly kind: 'canceled' }
  | { readonly kind: 'denied'; readonly reason: string };

/**
 * Opens the matching system picker and maps the result onto draft attachments.
 *
 * Only file URIs, names, sizes and MIME types leave this module. Bytes are read
 * later, during upload, so a large pick does not sit in memory while typing.
 */
export async function pickAttachments(
  source: AttachmentSource,
  options: { readonly remainingSlots: number },
): Promise<AttachmentPickResult> {
  if (options.remainingSlots <= 0) {
    return { kind: 'denied', reason: '已达单条消息附件数量上限' };
  }
  if (source === 'document') {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: '*/*',
    });
    if (result.canceled) return { kind: 'canceled' };
    return {
      kind: 'picked',
      drafts: result.assets.slice(0, options.remainingSlots).map((asset) =>
        createAttachmentDraft({
          kind: 'file',
          name: asset.name,
          mime: asset.mimeType,
          bytes: asset.size,
          uri: asset.uri,
        }),
      ),
    };
  }

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return { kind: 'denied', reason: '需要相机权限才能拍照，可在系统设置中开启。' };
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled) return { kind: 'canceled' };
    return { kind: 'picked', drafts: result.assets.slice(0, options.remainingSlots).map(imageAssetToDraft) };
  }

  // The system photo picker does not need a library permission prompt on iOS 14+.
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: options.remainingSlots,
    orderedSelection: true,
    quality: 0.9,
  });
  if (result.canceled) return { kind: 'canceled' };
  return { kind: 'picked', drafts: result.assets.slice(0, options.remainingSlots).map(imageAssetToDraft) };
}

function imageAssetToDraft(asset: ImagePicker.ImagePickerAsset): PromptAttachmentDraft {
  return createAttachmentDraft({
    kind: 'image',
    name: asset.fileName ?? defaultImageName(asset.mimeType),
    mime: asset.mimeType,
    bytes: asset.fileSize,
    uri: asset.uri,
  });
}

function defaultImageName(mimeType: string | undefined): string {
  const extension = mimeType?.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  return `图片-${Date.now().toString(36)}.${extension}`;
}