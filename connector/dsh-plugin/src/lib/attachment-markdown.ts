import type { AttachmentCandidate } from './attachment-extract.js';

export const ATTACHMENT_URI_PREFIX = 'dsh-attachment://';

type LinkCandidate = Pick<AttachmentCandidate, 'attachmentId' | 'path'>;

/**
 * Rewrites only Markdown image destinations that exactly match a declared file.
 * Ordinary links and ambiguous duplicate declarations stay untouched. The
 * replacement happens in the mobile projection; the DSH session log is never
 * modified and the desktop path does not leave this Connector.
 */
export function rewriteAttachmentImageLinks(
  text: string,
  candidates: readonly LinkCandidate[],
): string {
  if (!text.includes('![')) return text;
  const idsByPath = new Map<string, string | null>();
  for (const candidate of candidates) {
    const existing = idsByPath.get(candidate.path);
    idsByPath.set(candidate.path, existing === undefined ? candidate.attachmentId : null);
  }

  let output = '';
  let cursor = 0;
  while (cursor < text.length) {
    const imageStart = text.indexOf('![', cursor);
    if (imageStart < 0) break;
    const labelEnd = closingBracket(text, imageStart + 1);
    if (labelEnd < 0 || text[labelEnd + 1] !== '(') {
      output += text.slice(cursor, imageStart + 2);
      cursor = imageStart + 2;
      continue;
    }
    const destination = imageDestination(text, labelEnd + 2);
    if (!destination) {
      output += text.slice(cursor, imageStart + 2);
      cursor = imageStart + 2;
      continue;
    }
    const attachmentId = idsByPath.get(destination.path);
    if (!attachmentId) {
      output += text.slice(cursor, destination.end);
      cursor = destination.end;
      continue;
    }
    output += text.slice(cursor, destination.start);
    output += ATTACHMENT_URI_PREFIX + attachmentId;
    cursor = destination.end;
  }
  return output + text.slice(cursor);
}

function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function imageDestination(
  text: string,
  openParen: number,
): { readonly path: string; readonly start: number; readonly end: number } | null {
  let index = openParen;
  while (/\s/.test(text[index] ?? '')) index += 1;
  if (text[index] === '<') {
    const start = index + 1;
    const close = text.indexOf('>', start);
    if (close < 0) return null;
    const closeParen = text.indexOf(')', close + 1);
    if (closeParen < 0) return null;
    return { path: text.slice(start, close), start, end: close };
  }

  const start = index;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length) {
      index += 2;
      continue;
    }
    if (char === ')' || /\s/.test(char ?? '')) break;
    index += 1;
  }
  if (index === start) return null;
  return { path: text.slice(start, index), start, end: index };
}
