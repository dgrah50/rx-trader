import { describe, expect, it } from 'vitest';
import { planRebalance, flattenBalancesState } from './plan';
import type { BalanceSnapshot } from '../balances/types';
import type { RebalanceTarget } from './types';

const balances: BalanceSnapshot[] = [
  { venue: 'binance', asset: 'USDT', available: 8000, locked: 0 },
  { venue: 'hyperliquid', asset: 'USDT', available: 1000, locked: 0 },
  { venue: 'binance', asset: 'BTC', available: 0.5, locked: 0 },
  { venue: 'hyperliquid', asset: 'BTC', available: 0.05, locked: 0 }
];

describe('planRebalance', () => {
  it('proposes transfers to satisfy min targets', () => {
    const targets: RebalanceTarget[] = [
      { venue: 'hyperliquid', asset: 'USDT', min: 5000 },
      { venue: 'binance', asset: 'USDT', max: 4000 }
    ];
    const plan = planRebalance(balances, targets);
    expect(plan.transfers).toHaveLength(1);
    expect(plan.transfers[0]).toEqual(
      expect.objectContaining({
        from: { venue: 'binance', asset: 'USDT' },
        to: { venue: 'hyperliquid', asset: 'USDT' }
      })
    );
    expect(plan.deficits).toHaveLength(0);
  });

  it('reports unresolved deficits when no surplus exists', () => {
    const targets: RebalanceTarget[] = [{ venue: 'hyperliquid', asset: 'BTC', min: 1 }];
    const plan = planRebalance(balances, targets);
    expect(plan.transfers).toHaveLength(0);
    expect(plan.deficits).toEqual([
      expect.objectContaining({ venue: 'hyperliquid', asset: 'BTC' })
    ]);
  });
});

describe('flattenBalancesState', () => {
  it('converts nested map to snapshots', () => {
    const state = {
      binance: {
        USDT: { available: 100, locked: 10, total: 110, lastUpdated: Date.now() }
      }
    } as any;
    const result = flattenBalancesState(state);
    expect(result).toEqual([
      { venue: 'binance', asset: 'USDT', available: 100, locked: 10 }
    ]);
  });
});
