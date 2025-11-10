import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from './eventStore';

describe('InMemoryEventStore', () => {
  it('appends and reads events', async () => {
    const store = new InMemoryEventStore();
    await store.append({
      id: crypto.randomUUID(),
      type: 'market.tick',
      data: { t: Date.now(), symbol: 'TEST', bid: 1 },
      ts: Date.now()
    });

    const events = await store.read();
    expect(events).toHaveLength(1);
  });
});
