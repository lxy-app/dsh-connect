/** Aggregates arbitrary native PCM buffers into ASR-friendly packets without dropping tails. */
export class PcmChunker {
  private pending = new Uint8Array(0);

  constructor(readonly chunkBytes: number = 6_400) {
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes % 2 !== 0) {
      throw new Error('PCM chunk size must be a positive even number of bytes.');
    }
  }

  push(input: Uint8Array): Uint8Array[] {
    if (input.byteLength === 0) return [];
    const combined = new Uint8Array(this.pending.byteLength + input.byteLength);
    combined.set(this.pending, 0);
    combined.set(input, this.pending.byteLength);

    const completeBytes = Math.floor(combined.byteLength / this.chunkBytes) * this.chunkBytes;
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < completeBytes; offset += this.chunkBytes) {
      chunks.push(combined.slice(offset, offset + this.chunkBytes));
    }
    this.pending = combined.slice(completeBytes);
    return chunks;
  }

  flush(): Uint8Array | null {
    if (this.pending.byteLength === 0) return null;
    const tail = this.pending;
    this.pending = new Uint8Array(0);
    return tail;
  }

  reset(): void {
    this.pending = new Uint8Array(0);
  }
}
