import { useCallback, useEffect, useRef } from 'react';

import { discardPickedAttachments } from '@/lib/attachment-picker-cache';

type UriOwner = { readonly uri: string };

/**
 * Tracks native cache files owned by this screen. Upload/prompt retries keep ownership;
 * remove/success release it, and unmount abandons whatever the screen still owns.
 */
export function usePickedAttachmentCache() {
  const ownedUris = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    const uris = ownedUris.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const uri of uris) discardPickedAttachments([{ uri }]);
      uris.clear();
    };
  }, []);

  const own = useCallback((attachments: readonly UriOwner[]): boolean => {
    if (!mounted.current) {
      discardPickedAttachments(attachments);
      return false;
    }
    for (const attachment of attachments) ownedUris.current.add(attachment.uri);
    return true;
  }, []);

  const release = useCallback((attachments: readonly UriOwner[]) => {
    for (const attachment of attachments) ownedUris.current.delete(attachment.uri);
    discardPickedAttachments(attachments);
  }, []);

  return { own, release };
}
