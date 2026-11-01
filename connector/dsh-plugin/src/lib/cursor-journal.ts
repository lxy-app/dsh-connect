import { protocolError } from './request-cache.js';

/** Tracks durable per-session sequence numbers, excluding ephemeral streams. */
export class CursorJournal {
  readonly #cursors: Map<string, number>;

  constructor(initial: Readonly<Record<string, number>> = {}) {
    this.#cursors = new Map(Object.entries(initial));
  }

  cursor(sessionId: string): number {
    const value = this.#cursors.get(sessionId);
    return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  /** Returns true for a new event and false for a replayed event. */
  accept(sessionId: string, seq: number): boolean {
    if (!sessionId || !Number.isSafeInteger(seq) || seq <= 0) {
      throw protocolError('invalid_event_cursor', 'Durable events require a positive integer seq');
    }
    const current = this.cursor(sessionId);
    if (seq <= current) return false;
    if (seq !== current + 1) {
      throw protocolError(
        'event_sequence_gap',
        `Expected seq ${current + 1} for ${sessionId}, received ${seq}`,
        true,
      );
    }
    this.#cursors.set(sessionId, seq);
    return true;
  }

  /** A fresh DSH snapshot establishes a new baseline after cursor invalidation. */
  reset(sessionId: string, seq = 0): void {
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw protocolError('invalid_event_cursor', 'Snapshot cursor must be a non-negative integer');
    }
    this.#cursors.set(sessionId, seq);
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.#cursors);
  }
}
