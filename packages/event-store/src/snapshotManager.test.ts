import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryEventStore } from './eventStore';
import { savePositionsSnapshot, loadPositionsSnapshot, replayPositionsFromSnapshot } from './snapshotManager';
import { createManualClock } from '@rx-trader/core/time';

const clock = createManualClock(1_000);
const event = {
  id: crypto.randomUUID(),
  type: 'order.fill' as const,
  data: {
    id: crypto.randomUUID(),
    orderId: crypto.randomUUID(),
    t: clock.now(),
    symbol: 'SIM',
    px: 100,
    qty: 1,
    side: 'BUY'
  },
  ts: clock.now()
};

describe('snapshotManager', () => {
  it('saves and replays positions snapshot', async () => {
    const store = new InMemoryEventStore();
    await store.append(event);
    await store.append({
      id: crypto.randomUUID(),
      type: 'portfolio.snapshot',
      data: {
        t: clock.now(),
        positions: {
          SIM: {
            t: clock.now(),
            symbol: 'SIM',
            pos: 1,
            px: 101,
            avgPx: 100,
            unrealized: 1,
            realized: 0,
            netRealized: 0,
            grossRealized: 0,
            notional: 101,
            pnl: 1
          }
        },
        nav: 101,
        pnl: 1,
        realized: 0,
        netRealized: 0,
        grossRealized: 0,
        unrealized: 1,
        cash: 0,
        feesPaid: 0
      },
      ts: clock.now()
    });
    await store.append({
      id: crypto.randomUUID(),
      type: 'account.balance.adjusted',
      data: {
        id: crypto.randomUUID(),
        t: clock.now(),
        accountId: 'ACC1',
        venue: 'paper',
        asset: 'USD',
        delta: 1000
      },
      ts: clock.now()
    });

    const dir = mkdtempSync(join(tmpdir(), 'snapshot-test-'));
    const file = join(dir, 'positions.json');
    const snapshot = await savePositionsSnapshot(store, file, clock, {
      source: 'manual',
      startMs: 1_000,
      label: 'test'
    });
    expect(snapshot.positions.SIM?.pos).toBe(1);
    expect(snapshot.balances?.paper?.USD?.total).toBe(1000);
    expect(snapshot.ts).toBe(clock.now());
    expect(snapshot.clock?.source).toBe('manual');
    expect(snapshot.clock?.startMs).toBe(1_000);
    expect(snapshot.clock?.capturedMs).toBe(clock.now());

    const loaded = loadPositionsSnapshot(file);
    const replayed = await replayPositionsFromSnapshot(store, loaded);
    expect(replayed.positions.SIM?.pos).toBe(1);
    expect(replayed.balances?.paper?.USD?.total).toBe(1000);

    rmSync(dir, { recursive: true, force: true });
  });
});
