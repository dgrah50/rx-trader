import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@rx-trader/core/domain';
import {
  positionsProjection,
  pnlProjection,
  balancesProjection,
  marginProjection,
  balanceSnapshotsProjection,
  buildProjection
} from './projections';
import { InMemoryEventStore } from './eventStore';

const snapshotEvent = (overrides: Partial<any> = {}) => ({
  id: crypto.randomUUID(),
  type: 'portfolio.snapshot' as const,
  ts: Date.now(),
  data: {
    t: Date.now(),
    positions: {
      SIM: {
        t: Date.now(),
        symbol: 'SIM',
        pos: 1,
        px: 101,
        avgPx: 100,
        unrealized: 1,
        realized: 0,
        notional: 101
      }
    },
    nav: 101,
    pnl: 1,
    realized: 0,
    unrealized: 1,
    cash: 0,
    feesPaid: 0,
    ...overrides
  }
});

describe('positionsProjection', () => {
  it('mirrors the latest portfolio snapshot', async () => {
    const store = new InMemoryEventStore();
    await store.append(snapshotEvent());

    const state = await buildProjection(store, positionsProjection);
    expect(state.positions.SIM?.pos).toBe(1);
    expect(state.positions.SIM?.px).toBe(101);
  });
});

describe('pnlProjection', () => {
  it('stores the latest analytics payload', async () => {
    const store = new InMemoryEventStore();
    await store.append({
      id: crypto.randomUUID(),
      type: 'pnl.analytics',
      ts: Date.now(),
      data: {
        t: Date.now(),
        nav: 1000,
        pnl: 10,
        realized: 5,
        unrealized: 5,
        cash: 990,
        peakNav: 1005,
        drawdown: -5,
        drawdownPct: -0.005,
        feesPaid: 2,
        symbols: {
          SIM: {
            symbol: 'SIM',
            pos: 1,
            avgPx: 100,
            markPx: 102,
            realized: 2,
            unrealized: 2,
            notional: 102
          }
        }
      }
    });

    const state = await buildProjection(store, pnlProjection);
    expect(state.latest?.nav).toBe(1000);
  });
});

describe('balancesProjection', () => {
  it('aggregates balance adjustments per venue/asset', async () => {
    const store = new InMemoryEventStore();
    await store.append({
      id: crypto.randomUUID(),
      type: 'account.balance.adjusted',
      ts: Date.now(),
      data: {
        id: crypto.randomUUID(),
        t: Date.now(),
        accountId: 'paper-demo',
        venue: 'paper',
        asset: 'USD',
        delta: 1_000,
        reason: 'deposit'
      }
    });
    await store.append({
      id: crypto.randomUUID(),
      type: 'account.balance.adjusted',
      ts: Date.now(),
      data: {
        id: crypto.randomUUID(),
        t: Date.now(),
        accountId: 'paper-demo',
        venue: 'paper',
        asset: 'USD',
        delta: -100,
        reason: 'fee'
      }
    });

    const state = await buildProjection(store, balancesProjection);
    expect(state.balances.paper.USD.total).toBe(900);
    expect(state.balances.paper.USD.available).toBe(900);
    expect(state.updatedAt).toBeGreaterThan(0);
  });

  it('uses newTotal when provided and validates delta consistency', () => {
    const state = balancesProjection.init();
    const baseEvent = {
      id: crypto.randomUUID(),
      type: 'account.balance.adjusted' as const,
      ts: Date.now(),
      data: {
        id: crypto.randomUUID(),
        t: Date.now(),
        accountId: 'paper',
        venue: 'paper',
        asset: 'USD',
        delta: 1_000,
        newTotal: 1_000,
        reason: 'sync'
      }
    } satisfies DomainEvent<'account.balance.adjusted'>;
    balancesProjection.reduce(state, baseEvent);
    expect(state.balances.paper.USD.total).toBe(1_000);

    const inconsistent = {
      ...baseEvent,
      data: {
        ...baseEvent.data,
        delta: 100,
        newTotal: 1_500
      }
    } satisfies DomainEvent<'account.balance.adjusted'>;

    expect(() => balancesProjection.reduce(state, inconsistent)).toThrow(/Balance delta mismatch/);
  });
});

describe('balanceSnapshotsProjection', () => {
  it('stores snapshot metadata per venue/asset', async () => {
    const store = new InMemoryEventStore();
    await store.append({
      id: crypto.randomUUID(),
      type: 'account.balance.snapshot',
      ts: Date.now(),
      data: {
        id: crypto.randomUUID(),
        t: Date.now(),
        accountId: 'paper',
        venue: 'paper',
        asset: 'USD',
        total: 1000,
        provider: 'mock',
        ledgerTotal: 950,
        drift: 50
      }
    });

    const state = await buildProjection(store, balanceSnapshotsProjection);
    expect(state.snapshots.paper.USD.total).toBe(1000);
    expect(state.snapshots.paper.USD.drift).toBe(50);
  });
});

describe('marginProjection', () => {
  it('stores latest venue margin summary', async () => {
    const store = new InMemoryEventStore();
    await store.append({
      id: crypto.randomUUID(),
      type: 'account.margin.updated',
      ts: Date.now(),
      data: {
        id: crypto.randomUUID(),
        t: Date.now(),
        accountId: 'paper-demo',
        venue: 'hyperliquid',
        summary: {
          venue: 'hyperliquid',
          equity: 10_000,
          marginUsed: 2_000,
          maintenance: 1_000,
          leverageCap: 10,
          collateralAsset: 'USD'
        }
      }
    });

    const state = await buildProjection(store, marginProjection);
    expect(state.summaries.hyperliquid?.equity).toBe(10_000);
    expect(state.updatedAt).toBeGreaterThan(0);
  });
});
