import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { PostgresEventStore } from './postgresEventStore';

const createStore = async () => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const store = new PostgresEventStore(pool, { tableName: 'events' });
  await store.init();
  return { store, pool };
};

describe('PostgresEventStore', () => {
  it('appends and reads events', async () => {
    const { store } = await createStore();
    const now = Date.now();
    await store.append({
      id: crypto.randomUUID(),
      type: 'market.tick',
      data: { t: now, symbol: 'SIM', bid: 1 },
      ts: now
    });
    const events = await store.read();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('market.tick');
  });

  it('filters by timestamp', async () => {
    const { store } = await createStore();
    await store.append({
      id: crypto.randomUUID(),
      type: 'market.tick',
      data: { t: 1, symbol: 'SIM', bid: 1 },
      ts: 1
    });
    await store.append({
      id: crypto.randomUUID(),
      type: 'market.tick',
      data: { t: 2, symbol: 'SIM', bid: 2 },
      ts: 2
    });
    const events = await store.read(1);
    expect(events).toHaveLength(1);
    expect((events[0]?.data as any).bid).toBe(2);
  });
});
