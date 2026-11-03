import type { FileBaseline } from './attachment-policy.js';

/** A declaration the Connector resolved and may later read. */
export interface StoredDeclaration {
  readonly attachmentId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly source: 'deliverable' | 'tool';
  readonly seq: number;
  /** Desktop-only absolute path; never serialized to the Server. */
  readonly path: string;
  readonly name: string;
  readonly description?: string;
  readonly kind: 'image' | 'file';
  readonly mime: string;
  readonly bytes: number;
  readonly baseline: FileBaseline;
}

/**
 * Per-session attachment index.
 *
 * It exists so `session.attachment.fetch` can turn an opaque id back into a
 * path the Connector itself declared earlier. An id that is not here is
 * `attachment_unknown`, which is what stops a phone from probing paths.
 */
export class AttachmentIndex {
  readonly #sessions = new Map<string, Map<string, StoredDeclaration>>();
  readonly #maxPerSession: number;

  constructor({ maxPerSession = 500 }: { readonly maxPerSession?: number } = {}) {
    this.#maxPerSession = maxPerSession;
  }

  remember(declaration: StoredDeclaration): void {
    let session = this.#sessions.get(declaration.sessionId);
    if (!session) {
      session = new Map();
      this.#sessions.set(declaration.sessionId, session);
    }
    session.set(declaration.attachmentId, declaration);
    if (session.size > this.#maxPerSession) {
      // Drop the oldest declaration; the next transcript re-learns it.
      const oldest = session.keys().next();
      if (!oldest.done) session.delete(oldest.value);
    }
  }

  get(sessionId: string, attachmentId: string): StoredDeclaration | undefined {
    return this.#sessions.get(sessionId)?.get(attachmentId);
  }

  forget(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  clear(): void {
    this.#sessions.clear();
  }

  get size(): number {
    let total = 0;
    for (const session of this.#sessions.values()) total += session.size;
    return total;
  }
}
