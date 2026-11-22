/**
 * Navigation policy for downloaded HTML rendered from a cached string. Inline
 * data and blob URLs are allowed; http(s), mailto and every external or local
 * file destination stay out of the preview. No server URL or credential is
 * accepted here.
 */
export function canNavigateLocalHtml(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return normalized.startsWith('data:')
    || normalized.startsWith('blob:')
    || normalized === 'about:blank';
}
