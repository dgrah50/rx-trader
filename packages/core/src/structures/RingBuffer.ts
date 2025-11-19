export class RingBuffer<T> {
  private buffer: Array<T | undefined>;
  private capacity: number;
  private head: number = 0;
  private tail: number = 0;
  private size: number = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    } else {
      this.tail = (this.tail + 1) % this.capacity;
    }
  }

  getAll(): T[] {
    if (this.size === 0) {
      return [];
    }

    const result: T[] = new Array(this.size);
    let index = this.tail;
    for (let i = 0; i < this.size; i++) {
      result[i] = this.buffer[index] as T;
      index = (index + 1) % this.capacity;
    }
    return result;
  }

  getRecent(count: number): T[] {
    if (this.size === 0) {
      return [];
    }

    const limit = Math.min(count, this.size);
    const result: T[] = new Array(limit);
    // Start from the newest item (head - 1) and go backwards
    let index = (this.head - 1 + this.capacity) % this.capacity;
    
    for (let i = 0; i < limit; i++) {
      result[i] = this.buffer[index] as T;
      index = (index - 1 + this.capacity) % this.capacity;
    }
    
    return result; // Returns newest first
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.size = 0;
    this.buffer.fill(undefined);
  }

  get length(): number {
    return this.size;
  }
}
