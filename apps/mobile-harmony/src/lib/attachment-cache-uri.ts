/** Only the native picker's UUID cache files may be deleted by the JS owner. */
export function isPickedAttachmentCacheUri(uri: string, cacheDirectoryUri: string): boolean {
  const prefix = `${cacheDirectoryUri.replace(/\/+$/, '')}/`;
  if (!uri.startsWith(prefix)) return false;
  const fileName = uri.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(\.[a-z0-9]{1,16})?$/i.test(fileName);
}

/** Matches the authority-free absolute file URIs accepted by Expo File System. */
export function isExpoCompatibleFileUri(uri: string): boolean {
  return /^file:\/\/(?:localhost)?\//i.test(uri);
}
