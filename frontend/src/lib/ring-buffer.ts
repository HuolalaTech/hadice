// frontend/src/lib/ring-buffer.ts

export interface RingBufferStats {
  totalEntries: number;
  capacity: number;
  memoryEstimate: number;
}

export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private writeHead = 0;
  private _size = 0;
  readonly capacity: number;
  private bytesPerEntry: number;

  constructor(capacity: number = 100_000, bytesPerEntry: number = 520) {
    this.capacity = capacity;
    this.buffer = new Array<T>(capacity);
    this.bytesPerEntry = bytesPerEntry;
  }

  push(entry: T): void {
    this.buffer[this.writeHead % this.capacity] = entry;
    this.writeHead++;
    if (this._size < this.capacity) {
      this._size++;
    }
  }

  pushBatch(entries: T[]): void {
    for (let i = 0; i < entries.length; i++) {
      this.push(entries[i]);
    }
  }

  getEntries(): T[] {
    if (this._size === 0) return [];
    const start = this.writeHead - this._size;
    const result: T[] = new Array(this._size);
    let idx = 0;
    for (let i = start; i < this.writeHead; i++) {
      const entry = this.buffer[i % this.capacity];
      if (entry !== undefined) {
        result[idx++] = entry;
      }
    }
    return idx === result.length ? result : result.slice(0, idx);
  }

  getNewest(count: number): T[] {
    if (count <= 0 || this._size === 0) return [];
    const result: T[] = [];
    const end = this.writeHead;
    const start = Math.max(end - this._size, end - count);
    for (let i = end - 1; i >= start; i--) {
      const entry = this.buffer[i % this.capacity];
      if (entry !== undefined) {
        result.push(entry);
      }
    }
    return result.reverse();
  }

  clear(): void {
    const start = this.writeHead - this._size;
    for (let i = start; i < this.writeHead; i++) {
      this.buffer[i % this.capacity] = undefined;
    }
    this.writeHead = 0;
    this._size = 0;
  }

  getStats(): RingBufferStats {
    return {
      totalEntries: this._size,
      capacity: this.capacity,
      memoryEstimate: this._size * this.bytesPerEntry,
    };
  }

  get size(): number {
    return this._size;
  }
}
