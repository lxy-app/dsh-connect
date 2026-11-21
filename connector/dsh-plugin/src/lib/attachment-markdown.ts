import path from 'node:path';

import type { AttachmentCandidate } from './attachment-extract.js';

export const ATTACHMENT_URI_PREFIX = 'dsh-attachment://';

type LinkCandidate = Pick<AttachmentCandidate, 'attachmentId' | 'path'>;

/**
 * Rewrites Markdown image and ordinary file-link destinations that exactly
 * match a declared file in the same turn. Relative destinations are resolved
 * against the authorized workspace root inside the Connector; they never leave
 * this process. Ambiguous duplicate declarations, filename-only matches and
 * unrelated links stay untouched. The replacement happens in the mobile
 * projection; the DSH session log is never modified and the desktop path does
 * not leave this Connector.
 */
export function rewriteAttachmentLinks(
  text: string,
  candidates: readonly LinkCandidate[],
  workspaceRoot = '',
): string {
  if (!text.includes('](')) return text;
  const idsByPath = new Map<string, string | null>();
  for (const candidate of candidates) {
    const existing = idsByPath.get(candidate.path);
    idsByPath.set(candidate.path, existing === undefined ? candidate.attachmentId : null);
  }

  let output = '';
  let cursor = 0;
  while (cursor < text.length) {
    const linkStart = findLinkStart(text, cursor);
    if (linkStart < 0) break;
    const labelEnd = closingBracket(text, linkStart);
    if (labelEnd < 0 || text[labelEnd + 1] !== '(') {
      output += text.slice(cursor, linkStart + 1);
      cursor = linkStart + 1;
      continue;
    }
    const destination = linkDestination(text, labelEnd + 2);
    if (!destination) {
      output += text.slice(cursor, linkStart + 1);
      cursor = linkStart + 1;
      continue;
    }
    const attachmentId = idsByPath.get(resolveLinkPath(destination.path, workspaceRoot));
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

/** Backwards-compatible alias for callers that only rewrite images. */
export const rewriteAttachmentImageLinks = rewriteAttachmentLinks;

/**
 * Resolves a Markdown destination against the authorized workspace root.
 * Only local file paths are considered; URLs, anchors and unknown schemes keep
 * their original form and therefore never match a declaration.
 */
function resolveLinkPath(destination: string, workspaceRoot: string): string {
  if (!destination || /^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith('#')) {
    return destination;
  }
  if (path.isAbsolute(destination)) return path.normalize(destination);
  if (!workspaceRoot) return destination;
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, destination);
  // Relative links may never escape the authorized workspace root.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return destination;
  return resolved;
}

/** Finds the next `[` that opens a Markdown link label, skipping code spans. */
function findLinkStart(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '`') {
      const fenceEnd = text.indexOf('`', index + 1);
      if (fenceEnd < 0) return -1;
      index = fenceEnd + 1;
      continue;
    }
    if (char === '[') return index;
    index += 1;
  }
  return -1;
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

function linkDestination(
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
