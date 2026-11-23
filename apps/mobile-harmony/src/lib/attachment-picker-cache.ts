import { Directory, File, Paths } from 'expo-file-system';

import { isPickedAttachmentCacheUri } from '@/lib/attachment-cache-uri';

type UriOwner = { readonly uri: string };

function pickedCacheDirectory(): Directory {
  return new Directory(Paths.cache, 'attachment-picks');
}

/** Best-effort cleanup must never turn a completed send or remove action into a failure. */
export function discardPickedAttachment(uri: string): void {
  if (!isPickedAttachmentCacheUri(uri, pickedCacheDirectory().uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The OS may reclaim cache files independently; a later pick gets a fresh UUID.
  }
}

export function discardPickedAttachments(attachments: readonly UriOwner[]): void {
  for (const attachment of attachments) discardPickedAttachment(attachment.uri);
}

/** Cleans a valid native envelope when stricter JS validation refuses its drafts. */
export function discardPickedAttachmentPayload(serialized: string): void {
  try {
    const payload = JSON.parse(serialized) as unknown;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return;
    const assets = (payload as Record<string, unknown>).assets;
    if (!Array.isArray(assets)) return;
    for (const asset of assets) {
      if (asset !== null && typeof asset === 'object' && !Array.isArray(asset)) {
        const uri = (asset as Record<string, unknown>).uri;
        if (typeof uri === 'string') discardPickedAttachment(uri);
      }
    }
  } catch {
    // Native owns its valid JSON contract; malformed external input has no trusted URI to delete.
  }
}
