import type { ImageSource } from 'expo-image';

import { buildAttachmentUrl } from '@/lib/mobile-api';
import type { MobileAttachment } from '@/types/mobile';

export type AttachmentImageAuth = { readonly serverUrl: string; readonly accessToken: string };

export const ATTACHMENT_AUTO_RETRY_LIMIT = 60;
export const ATTACHMENT_URI_PREFIX = 'dsh-attachment://';

/** Resolves only the exact opaque URI form emitted by the Connector. */
export function attachmentIdFromHref(href: string): string | undefined {
  if (!href.startsWith(ATTACHMENT_URI_PREFIX)) return undefined;
  const attachmentId = href.slice(ATTACHMENT_URI_PREFIX.length);
  return /^att_[A-Za-z0-9_-]{8,64}$/.test(attachmentId) ? attachmentId : undefined;
}

/** Builds the authenticated native image source without exposing a desktop path. */
export function attachmentImageSource(
  attachment: Pick<MobileAttachment, 'attachmentId' | 'sha256'>,
  auth: AttachmentImageAuth,
  retryCount = 0,
): ImageSource {
  const url = new URL(buildAttachmentUrl(auth.serverUrl, attachment.attachmentId));
  if (attachment.sha256) url.searchParams.set('v', attachment.sha256.slice(0, 8));
  // SDWebImage can remember a failed URL. A retry must be a real new request,
  // not merely a React effect with the same URL.
  if (retryCount > 0) url.searchParams.set('retry', String(retryCount));
  return {
    uri: url.toString(),
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    cacheKey: attachment.sha256 ?? attachment.attachmentId,
  };
}

/**
 * A 202 response is an expected part of the fetch handshake. Native image
 * loaders expose it only as a failed decode, so retry while the transcript says
 * the desktop is preparing the bytes. Other states require a fresh transcript
 * or an explicit user retry instead of polling an error indefinitely.
 */
export function shouldAutoRetryAttachment(
  state: MobileAttachment['state'],
  error: string | null,
  retryCount: number,
): boolean {
  return error !== null
    && (state === 'known' || state === 'fetching')
    && retryCount < ATTACHMENT_AUTO_RETRY_LIMIT;
}
