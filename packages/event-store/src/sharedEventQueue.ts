import { TextDecoder, TextEncoder } from 'node:util';
import type { DomainEvent } from '@rx-trader/core/domain';

export interface SharedQueueHandles {
  control: SharedArrayBuffer;
  buffer: SharedArrayBuffer;
  capacity: number;
  slotSize: number;
}

const HEAD_INDEX = 0;
const TAIL_INDEX = 1;
const SIZE_INDEX = 2;
const SHUTDOWN_INDEX = 3;

const HEADER_BYTES = 4; // Uint32 length prefix

export interface SharedQueueProducer {
  enqueue(event: DomainEvent): boolean;
  depth(): number;
  capacity(): number;
  handles(): SharedQueueHandles;
}

export interface SharedQueueConsumer {
  dequeueBatch(maxItems: number, waitMs: number): DomainEvent[];
  shutdown(): void;
}

export const createSharedEventQueue = (
  capacity = 2048,
  slotSize = 2048
): SharedQueueProducer => {
  const control = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
  const buffer = new SharedArrayBuffer(slotSize * capacity);
  const handles: SharedQueueHandles = { control, buffer, capacity, slotSize };
  return new Producer(handles);
};

export const createSharedEventQueueConsumer = (handles: SharedQueueHandles): SharedQueueConsumer => {
  return new Consumer(handles);
};

class Producer implements SharedQueueProducer {
  private readonly control: Int32Array;
  private readonly buffer: Uint8Array;
  private readonly handlesRef: SharedQueueHandles;
  private readonly encoder = new TextEncoder();

  constructor(handles: SharedQueueHandles) {
    this.control = new Int32Array(handles.control);
    this.buffer = new Uint8Array(handles.buffer);
    this.handlesRef = handles;
  }

  enqueue(event: DomainEvent): boolean {
    const payload = this.encoder.encode(JSON.stringify(event));
    if (payload.length + HEADER_BYTES > this.handlesRef.slotSize) {
      throw new Error(`Event payload exceeds slot size (${this.handlesRef.slotSize} bytes)`);
    }

    const size = Atomics.load(this.control, SIZE_INDEX);
    if (size >= this.handlesRef.capacity) {
      return false;
    }

    const tail = Atomics.load(this.control, TAIL_INDEX);
    const slot = tail % this.handlesRef.capacity;
    const offset = slot * this.handlesRef.slotSize;
    const view = new DataView(this.buffer.buffer, offset, this.handlesRef.slotSize);
    view.setUint32(0, payload.length, true);
    this.buffer.set(payload, offset + HEADER_BYTES);

    Atomics.store(this.control, TAIL_INDEX, tail + 1);
    Atomics.add(this.control, SIZE_INDEX, 1);
    Atomics.notify(this.control, SIZE_INDEX, 1);
    return true;
  }

  depth(): number {
    return Atomics.load(this.control, SIZE_INDEX);
  }

  capacity(): number {
    return this.handlesRef.capacity;
  }

  handles(): SharedQueueHandles {
    return this.handlesRef;
  }
}

class Consumer implements SharedQueueConsumer {
  private readonly control: Int32Array;
  private readonly buffer: Uint8Array;
  private readonly handles: SharedQueueHandles;
  private readonly decoder = new TextDecoder();

  constructor(handles: SharedQueueHandles) {
    this.control = new Int32Array(handles.control);
    this.buffer = new Uint8Array(handles.buffer);
    this.handles = handles;
  }

  dequeueBatch(maxItems: number, waitMs: number): DomainEvent[] {
    const events: DomainEvent[] = [];
    while (events.length < maxItems) {
      let size = Atomics.load(this.control, SIZE_INDEX);
      if (size === 0) {
        if (events.length > 0) break;
        Atomics.wait(this.control, SIZE_INDEX, 0, waitMs);
        size = Atomics.load(this.control, SIZE_INDEX);
        if (size === 0) break;
      }

      const head = Atomics.load(this.control, HEAD_INDEX);
      const slot = head % this.handles.capacity;
      const offset = slot * this.handles.slotSize;
      const view = new DataView(this.buffer.buffer, offset, this.handles.slotSize);
      const length = view.getUint32(0, true);
      const bytes = this.buffer.slice(offset + HEADER_BYTES, offset + HEADER_BYTES + length);
      const json = this.decoder.decode(bytes);
      events.push(JSON.parse(json) as DomainEvent);
      Atomics.store(this.control, HEAD_INDEX, head + 1);
      Atomics.sub(this.control, SIZE_INDEX, 1);
    }
    return events;
  }

  shutdown() {
    Atomics.store(this.control, SHUTDOWN_INDEX, 1);
    Atomics.notify(this.control, SIZE_INDEX);
  }
}
