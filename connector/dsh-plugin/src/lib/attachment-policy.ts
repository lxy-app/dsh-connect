import { lstat, realpath } from 'node:fs/promises';
import { basename, isAbsolute, resolve, sep } from 'node:path';

/**
 * One file's identity at declaration time. A later fetch re-reads it and
 * refuses to upload anything that no longer matches, so a file swapped after
 * the model declared it is never sent to the phone.
 */
export interface FileBaseline {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeNs: number;
}

export interface AttachmentPolicyOptions {
  readonly workspaceRoot: string;
  /** Delivered files outside the workspace root stay denied by default. */
  readonly allowOutsideWorkspace?: boolean;
  readonly maxBytes: number;
  readonly sensitiveNames?: readonly string[];
}

export type PolicyVerdict =
  | { readonly ok: true; readonly path: string; readonly bytes: number; readonly baseline: FileBaseline }
  | { readonly ok: false; readonly errorCode: string; readonly reason: string };

export const ATTACHMENT_ERROR_UNKNOWN = 'attachment_unknown';
export const ATTACHMENT_ERROR_UNAVAILABLE = 'attachment_unavailable';
export const ATTACHMENT_ERROR_CHANGED = 'attachment_changed';
export const ATTACHMENT_ERROR_TOO_LARGE = 'attachment_too_large';
export const ATTACHMENT_ERROR_DENIED = 'attachment_denied';
export const ATTACHMENT_ERROR_FAILED = 'attachment_failed';

/**
 * Credentials and browser profiles are refused regardless of any flag: a model
 * that delivers `~/.ssh/id_rsa` must not turn into a phone download.
 */
export const SENSITIVE_NAMES: readonly string[] = [
  '.ssh',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  '.aws',
  'credentials',
  '.env',
  '.netrc',
  '.npmrc',
  'shadow',
  'cookies',
  'login data',
];

const SENSITIVE_SUFFIXES: readonly string[] = ['.pem', '.key', '.p12', '.pfx'];

export function isSensitivePath(path: string): boolean {
  const segments = path.toLowerCase().split(/[\\/]+/).filter(Boolean);
  const name = (segments.at(-1) ?? '').toLowerCase();
  if (SENSITIVE_NAMES.includes(name)) return true;
  if (SENSITIVE_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  // Directory-shaped entries such as `.ssh/` or `Cookies/` anywhere in the path.
  return segments.some((segment) => SENSITIVE_NAMES.includes(segment));
}

/** Reads the identity tuple used for change detection. */
export async function readBaseline(path: string): Promise<FileBaseline> {
  const info = await lstat(path, { bigint: true });
  return {
    dev: Number(info.dev),
    ino: Number(info.ino),
    size: Number(info.size),
    mtimeNs: Number(info.mtimeNs),
  };
}

export function baselineMatches(left: FileBaseline, right: FileBaseline): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs;
}

/**
 * Resolves one declared path and decides whether it may be served.
 *
 * The order matters: cheap syntactic checks first, then the real path, then the
 * workspace boundary, then the file identity and size. Every failure returns a
 * stable code instead of throwing, so the transcript can show why a file is not
 * available rather than silently dropping it.
 */
export async function evaluateAttachmentPath(rawPath: string, options: AttachmentPolicyOptions): Promise<PolicyVerdict> {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.length > 1024 || rawPath.includes('\u0000')) {
    return { ok: false, errorCode: ATTACHMENT_ERROR_DENIED, reason: 'path is empty, too long or contains NUL' };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) {
    return { ok: false, errorCode: ATTACHMENT_ERROR_DENIED, reason: 'path must not be a URL' };
  }
  const absolute = isAbsolute(rawPath) ? rawPath : resolve(options.workspaceRoot, rawPath);
  if (isSensitivePath(absolute)) {
    return { ok: false, errorCode: ATTACHMENT_ERROR_DENIED, reason: 'path matches the sensitive-name list' };
  }
  let real: string;
  try {
    // Refuse a final symlink: realpath follows it, so compare against lstat first.
    const lstatInfo = await lstat(absolute);
    if (lstatInfo.isSymbolicLink()) {
      return { ok: false, errorCode: ATTACHMENT_ERROR_DENIED, reason: 'declared path is a symlink' };
    }
    if (!lstatInfo.isFile()) {
      return { ok: false, errorCode: ATTACHMENT_ERROR_UNAVAILABLE, reason: 'declared path is not a regular file' };
    }
    real = await realpath(absolute);
  } catch {
    return { ok: false, errorCode: ATTACHMENT_ERROR_UNAVAILABLE, reason: 'declared path is missing or unreadable' };
  }
  // Compare real paths on both sides: on macOS /tmp and /var are symlinks, so a
  // root taken from configuration would otherwise look like a different tree.
  const rootReal = await realpath(options.workspaceRoot).catch(() => resolve(options.workspaceRoot));
  if (!isInside(real, rootReal) && options.allowOutsideWorkspace !== true) {
    return {
      ok: false,
      errorCode: ATTACHMENT_ERROR_DENIED,
      reason: 'file is outside the workspace; enable outside-workspace deliverables on the desktop',
    };
  }
  const baseline = await readBaseline(real).catch(() => null);
  if (!baseline) {
    return { ok: false, errorCode: ATTACHMENT_ERROR_UNAVAILABLE, reason: 'could not stat the declared file' };
  }
  if (baseline.size > options.maxBytes) {
    return { ok: false, errorCode: ATTACHMENT_ERROR_TOO_LARGE, reason: 'file exceeds the attachment size limit' };
  }
  return { ok: true, path: real, bytes: baseline.size, baseline };
}

/** True when the resolved path stays under the workspace root. */
export function isInside(realPath: string, workspaceRoot: string): boolean {
  const root = resolve(workspaceRoot);
  const target = resolve(realPath);
  if (target === root) return true;
  return target.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** Display name without any directory component. */
export function displayName(path: string): string {
  return basename(path);
}
