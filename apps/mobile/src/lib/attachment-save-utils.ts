import type { MobileAttachment } from '@shared/types/mobile';

const GENERIC_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

const EXTENSION_MIMES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
};

const EXTENSION_UTIS: Readonly<Record<string, string>> = {
  pdf: 'com.adobe.pdf',
  doc: 'com.microsoft.word.doc',
  docx: 'org.openxmlformats.wordprocessingml.document',
  ppt: 'com.microsoft.powerpoint.ppt',
  pptx: 'org.openxmlformats.presentationml.presentation',
  xls: 'com.microsoft.excel.xls',
  xlsx: 'org.openxmlformats.spreadsheetml.sheet',
  md: 'net.daringfireball.markdown',
  markdown: 'net.daringfireball.markdown',
  txt: 'public.plain-text',
  log: 'public.plain-text',
  json: 'public.json',
  html: 'public.html',
  htm: 'public.html',
  png: 'public.png',
  jpg: 'public.jpeg',
  jpeg: 'public.jpeg',
  gif: 'com.compuserve.gif',
  webp: 'org.webmproject.webp',
  zip: 'public.zip-archive',
};

const MIME_UTIS: Readonly<Record<string, string>> = {
  'application/pdf': 'com.adobe.pdf',
  'application/msword': 'com.microsoft.word.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'org.openxmlformats.wordprocessingml.document',
  'application/vnd.ms-powerpoint': 'com.microsoft.powerpoint.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'org.openxmlformats.presentationml.presentation',
  'application/vnd.ms-excel': 'com.microsoft.excel.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'org.openxmlformats.spreadsheetml.sheet',
  'text/markdown': 'net.daringfireball.markdown',
  'text/x-markdown': 'net.daringfireball.markdown',
  'text/plain': 'public.plain-text',
  'application/json': 'public.json',
  'text/json': 'public.json',
  'text/html': 'public.html',
  'image/png': 'public.png',
  'image/jpeg': 'public.jpeg',
  'image/gif': 'com.compuserve.gif',
  'image/webp': 'org.webmproject.webp',
  'application/zip': 'public.zip-archive',
};

export function normalizeAttachmentSaveName(name: string): string {
  const normalized = name
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .trim();
  return normalized === '' || normalized === '.' || normalized === '..' ? 'attachment' : normalized;
}

export function attachmentFileExtension(name: string): string {
  const normalized = normalizeAttachmentSaveName(name).toLowerCase();
  const dot = normalized.lastIndexOf('.');
  return dot > 0 && dot < normalized.length - 1 ? normalized.slice(dot + 1) : '';
}

/** SAF createFileAsync takes a display-name stem; the provider adds the MIME extension. */
export function attachmentFileStem(name: string): string {
  const normalized = normalizeAttachmentSaveName(name);
  const extension = attachmentFileExtension(normalized);
  return extension ? normalized.slice(0, -(extension.length + 1)) : normalized;
}

/** Avoid known collisions case-insensitively; the Android provider remains the final arbiter. */
export function nextAvailableAttachmentFileName(
  name: string,
  existingNames: ReadonlySet<string>,
): string {
  const normalized = normalizeAttachmentSaveName(name);
  const extension = attachmentFileExtension(normalized);
  const stem = attachmentFileStem(normalized);
  const suffix = extension ? `.${normalized.slice(-extension.length)}` : '';
  const used = new Set([...existingNames].map((existing) => existing.toLowerCase()));
  for (let index = 0; ; index += 1) {
    const candidate = index === 0 ? normalized : `${stem} (${index})${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Best-effort display name for external-storage SAF URIs; opaque provider ids return null. */
export function attachmentNameFromSafUri(uri: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    return null;
  }
  const path = decoded.split(/[?#]/, 1)[0]?.replace(/\/+$/, '') ?? '';
  if (!path.startsWith('content://com.android.externalstorage.documents/')) return null;
  const name = path.split('/').pop()?.trim() ?? '';
  if (name === '' || (!name.includes('.') && name.includes(':'))) return null;
  return name;
}

export function attachmentMimeType(
  attachment: Pick<MobileAttachment, 'mime' | 'name'>,
): string {
  const mime = attachment.mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!GENERIC_MIMES.has(mime) && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)) {
    return mime;
  }
  return EXTENSION_MIMES[attachmentFileExtension(attachment.name)] ?? 'application/octet-stream';
}

export function attachmentUti(
  attachment: Pick<MobileAttachment, 'mime' | 'name'>,
): string | undefined {
  const mime = attachment.mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const extensionUti = EXTENSION_UTIS[attachmentFileExtension(attachment.name)];
  // Plain/generic metadata is refined by a source filename, matching preview classification.
  if (mime === 'text/plain' || GENERIC_MIMES.has(mime)) {
    return extensionUti ?? MIME_UTIS[mime];
  }
  return MIME_UTIS[mime] ?? extensionUti;
}

export function savedFileHasExpectedBytes(
  info: { readonly exists: boolean; readonly isDirectory: boolean; readonly size?: number },
  expectedBytes: number,
): boolean {
  return Number.isSafeInteger(expectedBytes)
    && expectedBytes >= 0
    && info.exists
    && !info.isDirectory
    && info.size === expectedBytes;
}
