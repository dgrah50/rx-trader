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

  it('publishes an economic event only once across retries', async () => {
    const store = new InMemoryEventStore();
    const streamed: string[] = [];
    store.stream$.subscribe((event) => streamed.push(event.id));
    const createEvent = () => ({
      id: crypto.randomUUID(),
      dedupeKey: 'fill:binance:trade-42',
      type: 'market.tick' as const,
      data: { t: 1, symbol: 'TEST', bid: 1 },
      ts: 1,
    });
    await store.append([createEvent(), createEvent()]);
    expect(await store.read()).toHaveLength(1);
    expect(streamed).toHaveLength(1);
  });

  it('does not publish a partial invalid batch', async () => {
    const store = new InMemoryEventStore();
    const streamed: string[] = [];
    store.stream$.subscribe((event) => streamed.push(event.id));
    const valid = {
      id: crypto.randomUUID(),
      type: 'market.tick' as const,
      data: { t: 1, symbol: 'TEST', bid: 1 },
      ts: 1,
    };
    const invalid = { ...valid, id: crypto.randomUUID(), data: { ...valid.data, bid: 'bad' } };
    await expect(store.append([valid, invalid as never])).rejects.toThrow();
    expect(await store.read()).toHaveLength(0);
    expect(streamed).toHaveLength(0);
  });
});
