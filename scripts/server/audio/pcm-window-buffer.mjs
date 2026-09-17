function toEven(value) {
  return Math.max(0, Math.floor(value / 2) * 2);
}

export class PcmWindowBuffer {
  constructor({ sampleRate = 16_000, windowMs = 2_200, overlapMs = 200, maxPendingMs = 8_000 } = {}) {
    this.bytesPerMs = (sampleRate * 2) / 1_000;
    this.windowBytes = toEven(windowMs * this.bytesPerMs);
    this.overlapBytes = toEven(Math.min(overlapMs, windowMs - 1) * this.bytesPerMs);
    this.consumeBytes = this.windowBytes - this.overlapBytes;
    this.maxBytes = toEven(Math.max(windowMs, maxPendingMs) * this.bytesPerMs);
    this.buffer = Buffer.alloc(0);
    this.droppedBytes = 0;
  }

  get byteLength() {
    return this.buffer.length;
  }

  push(chunk) {
    const pcm = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (pcm.length === 0) return 0;
    const evenPcm = pcm.length % 2 === 0 ? pcm : pcm.subarray(0, pcm.length - 1);
    this.buffer = Buffer.concat([this.buffer, evenPcm]);

    if (this.buffer.length <= this.maxBytes) return 0;
    const excess = toEven(this.buffer.length - this.maxBytes);
    this.buffer = this.buffer.subarray(excess);
    this.droppedBytes += excess;
    return excess;
  }

  takeReadyWindow() {
    if (this.buffer.length < this.windowBytes) return null;
    const window = this.buffer.subarray(0, this.windowBytes);
    this.buffer = this.buffer.subarray(this.consumeBytes);
    return window;
  }

  takeTail(minMs = 300) {
    const minimumBytes = toEven(minMs * this.bytesPerMs);
    if (this.buffer.length < minimumBytes) {
      this.buffer = Buffer.alloc(0);
      return null;
    }
    const tail = this.buffer;
    this.buffer = Buffer.alloc(0);
    return tail;
  }

  clear() {
    this.buffer = Buffer.alloc(0);
  }
}
