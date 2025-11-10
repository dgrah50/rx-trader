import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteEventStore } from './sqliteEventStore';
import type { DomainEvent } from '@rx-trader/core/domain';
import { Database } from 'bun:sqlite';

const createEvent = (overrides: Partial<DomainEvent> = {}): DomainEvent => ({
  id: crypto.randomUUID(),
  type: 'order.new',
  data: {
    id: crypto.randomUUID(),
    t: Date.now(),
    symbol: 'SIM',
    side: 'BUY',
    qty: 1,
    type: 'MKT',
    tif: 'DAY',
    account: 'TEST'
  },
  ts: Date.now(),
  ...overrides
});

describe('SqliteEventStore', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'rx-sqlite-'));

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists and reads events across instances', async () => {
    const file = join(tmpDir, `${crypto.randomUUID()}.db`);
    const store = new SqliteEventStore(file);
    const first = createEvent();
    const second = createEvent({ ts: first.ts + 1 });
    await store.append([first, second]);
    await store.close();

    const nextStore = new SqliteEventStore(file);
    const all = await nextStore.read();
    expect(all).toHaveLength(2);
    const filtered = await nextStore.read(first.ts);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(second.id);
    await nextStore.close();
  });

  it('ignores duplicate IDs', async () => {
    const file = join(tmpDir, `${crypto.randomUUID()}.db`);
    const store = new SqliteEventStore(file);
    const event = createEvent();
    await store.append([event, event]);
    const all = await store.read();
    expect(all.filter((e) => e.id === event.id)).toHaveLength(1);
    await store.close();
  });

  it('waits when the database is briefly locked', async () => {
    const file = join(tmpDir, `${crypto.randomUUID()}.db`);
    const store = new SqliteEventStore(file, { busyTimeoutMs: 100 });
    const locker = new Database(file);
    locker.exec('BEGIN IMMEDIATE');

    const baseData = createEvent().data as any;
    const appendPromise = store.append(
      createEvent({ data: { ...baseData, symbol: 'LOCK' } as any })
    );

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        locker.exec('COMMIT');
        locker.close();
        resolve();
      }, 100);
    });

    await appendPromise;
    const all = await store.read();
    expect(all).toHaveLength(1);
    await store.close();
  });
});
