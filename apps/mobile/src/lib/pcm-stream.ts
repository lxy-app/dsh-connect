export const PCM_STREAM_BUFFER_SAMPLES = 2_400;
export const PCM_STREAM_BUFFER_BYTES = PCM_STREAM_BUFFER_SAMPLES * 2;

/** Split arbitrary network chunks into 100 ms signed-16 LE playback buffers. */
export class PcmStreamChunker {
  private pending: number | null = null;
  constructor(private readonly bufferBytes = PCM_STREAM_BUFFER_BYTES) {}

  push(input: Uint8Array): Uint8Array[] {
    let bytes = input;
    if (this.pending !== null) {
      bytes = new Uint8Array(input.byteLength + 1);
      bytes[0] = this.pending;
      bytes.set(input, 1);
      this.pending = null;
    }
    const completeBytes = bytes.byteLength - (bytes.byteLength % 2);
    if (completeBytes !== bytes.byteLength) this.pending = bytes[bytes.byteLength - 1] ?? null;
    const result: Uint8Array[] = [];
    for (let offset = 0; offset + 2 <= completeBytes; offset += this.bufferBytes) {
      const end = Math.min(offset + this.bufferBytes, completeBytes);
      if (end > offset) result.push(bytes.slice(offset, end));
    }
    return result;
  }

  flush(): Uint8Array | null {
    if (this.pending !== null) throw new Error('PCM 音频流以半个采样字节结束。');
    return null;
  }
}

export function pcm16LeToFloat32(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  if (bytes.byteLength % 2 !== 0) throw new Error('PCM 音频字节数必须为偶数。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(new ArrayBuffer(bytes.byteLength * 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32_768;
  }
  return samples;
}

export function wrapPcmInWav(pcm: Uint8Array, sampleRate = 24_000): Uint8Array {
  if (pcm.byteLength % 2 !== 0) throw new Error('PCM 音频字节数必须为偶数。');
  const bytes = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  bytes.set(pcm, 44);
  return bytes;
}
