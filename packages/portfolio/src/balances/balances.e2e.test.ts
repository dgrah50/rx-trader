import { describe, it, expect } from 'vitest';
import { Subject } from 'rxjs';
import { createManualClock } from '@rx-trader/core/time';
import type { Fill } from '@rx-trader/core/domain';
import {
  InMemoryEventStore,
  balancesProjection,
  balanceSnapshotsProjection,
  buildProjection
} from '@rx-trader/event-store';
import { wireFillAccounting } from '../accounting';
import { BalanceSyncService } from './balanceSyncService';
import { MockBalanceProvider } from './mockProvider';
import type { DomainEvent } from '@rx-trader/core/domain';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

describe('balances end-to-end', () => {
  it('applies sync snapshots and fill adjustments to balances projection', async () => {
    const store = new InMemoryEventStore();
    const clock = createManualClock(1);
    let balanceState = balancesProjection.init();
    store.stream$.subscribe((event) => {
      balanceState = balancesProjection.reduce(balanceState, event as DomainEvent);
    });
    await store.append({
      id: crypto.randomUUID(),
      type: 'account.balance.adjusted',
      ts: clock.now(),
      data: {
        id: crypto.randomUUID(),
        t: clock.now(),
        accountId: 'DEMO',
        venue: 'paper',
        asset: 'USDT',
        delta: 1_000,
        reason: 'deposit'
      }
    });

    const fills$ = new Subject<Fill>();
    wireFillAccounting({
      fills$,
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      accountId: 'DEMO',
      venue: 'paper',
      enqueue: (event) => store.append(event as DomainEvent),
      clock
    });

    const provider = new MockBalanceProvider({
      venue: 'paper',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      fallbackPrice: 100,
      initialBase: 0,
      initialQuote: 1000
    });

  const balanceSync = new BalanceSyncService({
    accountId: 'DEMO',
    provider,
    getBalance: (venue, asset) => balanceState.balances[venue]?.[asset],
    enqueue: (event) => store.append(event as DomainEvent),
    enqueueSnapshot: (event) => store.append(event as DomainEvent),
    clock,
    intervalMs: 0,
    logger: noopLogger,
    applyLedgerDeltas: true
  });

    await balanceSync.syncOnce();
    const seeded = await buildProjection(store, balancesProjection);
    expect(seeded.balances.paper?.USDT?.available).toBeCloseTo(1000);
    expect(seeded.balances.paper?.BTC).toBeUndefined();

    const fill: Fill = {
      id: crypto.randomUUID(),
      orderId: crypto.randomUUID(),
      t: clock.now(),
      symbol: 'BTCUSDT',
      px: 100,
      qty: 0.5,
      side: 'BUY'
    };
    fills$.next(fill);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const updated = await buildProjection(store, balancesProjection);
    expect(updated.balances.paper?.BTC?.available).toBeCloseTo(0.5, 5);
    expect(updated.balances.paper?.USDT?.available).toBeCloseTo(950, 5);

    await balanceSync.syncOnce();
    const snapshotState = await buildProjection(store, balanceSnapshotsProjection);
    expect(snapshotState.snapshots.paper.USDT.drift).toBeCloseTo(50, 5);

    balanceSync.stop();
    fills$.complete();
  });
});
