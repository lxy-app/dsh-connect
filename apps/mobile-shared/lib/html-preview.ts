/** Return the directory a local HTML document may read for relative resources. */
export function htmlReadAccessDirectory(fileUri: string): string {
  const slash = fileUri.lastIndexOf('/');
  return slash > 0 ? fileUri.slice(0, slash + 1) : fileUri;
}

/**
 * Navigation policy for downloaded HTML. Local files, inline data and blob URLs
 * are allowed; http(s), mailto and every other external destination stay out of
 * the preview. No server URL, credential or desktop path is accepted here.
 */
export function canNavigateLocalHtml(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return normalized.startsWith('file:')
    || normalized.startsWith('data:')
    || normalized.startsWith('blob:')
    || normalized === 'about:blank';
}
