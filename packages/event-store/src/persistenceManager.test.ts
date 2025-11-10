import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteEventStore } from './sqliteEventStore';
import type { DomainEvent } from '@rx-trader/core/domain';
import { createPersistenceManager } from './persistenceManager';
import { persistenceWorkerUrl } from './index';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate: () => Promise<boolean> | boolean, timeoutMs = 15_000) => {
  const start = Date.now();
  let lastError: unknown;
  for (;;) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() - start > timeoutMs) {
      const details = lastError ? ` (last error: ${String(lastError)})` : '';
      throw new Error(`Timed out waiting for condition${details}`);
    }
    await sleep(50);
  }
};

const sampleEvent = (): DomainEvent<'order.new'> => {
  const orderId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    type: 'order.new',
    ts: Date.now(),
    data: {
      id: orderId,
      t: Date.now(),
      symbol: 'BTCUSDT',
      side: 'BUY',
      qty: 1,
      type: 'MKT',
      tif: 'DAY',
      account: 'TEST'
    }
  };
};

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

describe('createPersistenceManager', () => {
  it('persists events through the worker into SQLite', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'rx-persist-'));
    const sqlitePath = join(tempDir, 'events.sqlite');
    const store = new SqliteEventStore(sqlitePath);

    const manager = createPersistenceManager({
      store,
      logger: noopLogger,
      workerPath: persistenceWorkerUrl.href,
      envSnapshot: {
        NODE_ENV: 'test',
        EVENT_STORE_DRIVER: 'sqlite',
        SQLITE_PATH: sqlitePath,
        DEBUG_PERSIST_TEST: '1'
      },
      queueCapacity: 16,
      slotSize: 4096
    });

    const event = sampleEvent();
    manager.enqueue(event);

    let persisted: DomainEvent[] = [];
    await waitFor(async () => {
      persisted = await store.read();
      return persisted.some((e) => e.id === event.id);
    });
    expect(persisted.some((e) => e.id === event.id)).toBe(true);

    manager.shutdown();
    await sleep(50);
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }, 20000);
});
