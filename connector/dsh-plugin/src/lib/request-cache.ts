interface RequestCacheEntry<T> {
  readonly method: string;
  readonly fingerprint: string;
  readonly createdAt: number;
  promise: Promise<T> | null;
  value?: T;
  error?: unknown;
  settledAt?: number;
}

export interface RequestCacheOptions {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export class ProtocolError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * At-most-once execution cache for commands crossing an unreliable connection.
 * Both successful and failed outcomes are retained: after a command has been
 * handed to DSH, blindly retrying a timeout could otherwise submit it twice.
 */
export class RequestCache {
  readonly #entries = new Map<string, RequestCacheEntry<unknown>>();
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor({ ttlMs = 15 * 60_000, maxEntries = 1_000, now = Date.now }: RequestCacheOptions = {}) {
    if (ttlMs <= 0 || maxEntries <= 0) {
      throw new Error('ttlMs and maxEntries must be positive');
    }
    this.#now = now;
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
  }

  execute<T>(requestId: string, method: string, operation: () => T | Promise<T>, fingerprint = ''): Promise<T> {
    if (!requestId || typeof requestId !== 'string') {
      return Promise.reject(protocolError('invalid_request', 'requestId is required'));
    }
    if (typeof operation !== 'function') {
      return Promise.reject(new TypeError('operation must be a function'));
    }

    this.#prune();
    const existing = this.#entries.get(requestId);
    if (existing) {
      if (existing.method !== method || existing.fingerprint !== fingerprint) {
        return Promise.reject(protocolError(
          'idempotency_conflict',
          `requestId ${requestId} was already used with a different method or params`,
        ));
      }
      if (existing.promise) return existing.promise as Promise<T>;
      if (existing.error !== undefined) return Promise.reject(existing.error);
      return Promise.resolve(existing.value as T);
    }

    const entry: RequestCacheEntry<T> = {
      method,
      fingerprint,
      createdAt: this.#now(),
      promise: null,
    };
    // Publish the entry before invoking the operation so concurrent retries
    // share it even when the operation throws synchronously.
    entry.promise = Promise.resolve().then(operation).then(
      (value) => {
        entry.value = value;
        entry.promise = null;
        entry.settledAt = this.#now();
        return value;
      },
      (error: unknown) => {
        entry.error = error;
        entry.promise = null;
        entry.settledAt = this.#now();
        throw error;
      },
    );
    this.#entries.set(requestId, entry);
    return entry.promise;
  }

  get size(): number {
    return this.#entries.size;
  }

  #prune(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.settledAt !== undefined && now - entry.settledAt >= this.#ttlMs) {
        this.#entries.delete(key);
      }
    }
    if (this.#entries.size < this.#maxEntries) return;

    // Never evict an in-flight command. Evict oldest completed outcomes first.
    const settled = [...this.#entries.entries()]
      .filter(([, entry]) => !entry.promise)
      .sort((a, b) => (a[1].settledAt ?? 0) - (b[1].settledAt ?? 0));
    while (this.#entries.size >= this.#maxEntries && settled.length) {
      const oldest = settled.shift();
      if (oldest) this.#entries.delete(oldest[0]);
    }
  }
}

export function protocolError(code: string, message: string, retryable = false): ProtocolError {
  return new ProtocolError(code, message, retryable);
}
