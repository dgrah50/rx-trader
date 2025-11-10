import { describe, expect, it } from 'vitest';
import { createSharedEventQueue, createSharedEventQueueConsumer } from './sharedEventQueue';
import type { DomainEvent } from '@rx-trader/core/domain';

const sampleEvent = (id: string): DomainEvent => ({
  id,
  type: 'order.new',
  data: {
    id,
    t: Date.now(),
    symbol: 'SIM',
    side: 'BUY',
    qty: 1,
    type: 'MKT',
    tif: 'DAY',
    account: 'TEST'
  },
  ts: Date.now()
});

describe('sharedEventQueue', () => {
  it('enqueues and dequeues events', () => {
    const producer = createSharedEventQueue(8, 512);
    const consumer = createSharedEventQueueConsumer(producer.handles());

    expect(producer.enqueue(sampleEvent('1'))).toBe(true);
    expect(producer.enqueue(sampleEvent('2'))).toBe(true);

    const batch = consumer.dequeueBatch(10, 10);
    expect(batch).toHaveLength(2);
    expect(batch[0]?.id).toBe('1');
    expect(batch[1]?.id).toBe('2');
  });

  it('respects capacity', () => {
    const producer = createSharedEventQueue(1, 256);
    expect(producer.enqueue(sampleEvent('1'))).toBe(true);
    expect(producer.enqueue(sampleEvent('2'))).toBe(false);
  });
});
