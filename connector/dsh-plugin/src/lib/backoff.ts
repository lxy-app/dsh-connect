export interface ReconnectBackoffOptions {
  readonly initialMs?: number;
  readonly maxMs?: number;
  readonly random?: () => number;
}

/** Exponential reconnect backoff with equal jitter and no timer ownership. */
export class ReconnectBackoff {
  readonly #initialMs: number;
  readonly #maxMs: number;
  readonly #random: () => number;
  #attempt = 0;

  constructor({ initialMs = 500, maxMs = 30_000, random = Math.random }: ReconnectBackoffOptions = {}) {
    if (initialMs <= 0 || maxMs < initialMs) {
      throw new Error('invalid reconnect backoff bounds');
    }
    this.#initialMs = initialMs;
    this.#maxMs = maxMs;
    this.#random = random;
  }

  next(): number {
    const upper = Math.min(this.#maxMs, this.#initialMs * 2 ** this.#attempt);
    this.#attempt += 1;
    return Math.floor(upper * (0.5 + this.#random() * 0.5));
  }

  reset(): void {
    this.#attempt = 0;
  }
}
