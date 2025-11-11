import { describe, it, expect } from 'vitest';
import { Subject } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import type { StrategySignal } from '../types';
import { createIntentBuilder } from './index';

describe('createIntentBuilder', () => {
  it('uses side-aware edge with taker references and rejects negative edge', () => {
    const marks$ = new Subject<MarketTick>();
    const signals$ = new Subject<StrategySignal>();
    const intents: any[] = [];

    const build = createIntentBuilder({
      account: 'ACC',
      policy: {
        mode: 'market',
        defaultQty: 1,
        minEdgeBps: 5,
        takerFeeBps: 2,
        takerSlipBps: 1,
        tif: 'IOC'
      }
    });

    build(signals$, marks$).subscribe((o) => intents.push(o));

    marks$.next({ t: 1, symbol: 'BTCUSDT', bid: 100, ask: 100.5 });
    signals$.next({ symbol: 'BTCUSDT', action: 'BUY', px: 101, t: 2 });

    expect(intents).toHaveLength(1);
    expect(intents[0].type).toBe('MKT');
    expect(intents[0].meta.reason).toBe('TAKER_EDGE_OK');
    expect(intents[0].px).toBeUndefined();

    signals$.next({ symbol: 'BTCUSDT', action: 'BUY', px: 100.3, t: 3 });
    expect(intents).toHaveLength(1); // rejected because edge < required
  });

  it('produces limit intents with notional sizing and post-only rounding', () => {
    const marks$ = new Subject<MarketTick>();
    const signals$ = new Subject<StrategySignal>();
    const intents: any[] = [];

    const build = createIntentBuilder({
      account: 'ACC',
      policy: {
        mode: 'limit',
        defaultQty: 0.5,
        notionalUsd: 500,
        limitOffsetBps: 25,
        minEdgeBps: 0,
        makerFeeBps: 0,
        adverseSelectionBps: 0,
        postOnly: true,
        tif: 'DAY'
      },
      tickSize: 0.5,
      lotSize: 0.1
    });

    build(signals$, marks$).subscribe((o) => intents.push(o));

    marks$.next({ t: 1, symbol: 'ETHUSDT', bid: 100, ask: 101, last: 100.5 });
    signals$.next({ symbol: 'ETHUSDT', action: 'BUY', px: 105, t: 2 });

    expect(intents).toHaveLength(1);
    const order = intents[0];
    expect(order.type).toBe('LMT');
    expect(order.px).toBeLessThan(101);
    expect(order.qty).toBeCloseTo(5, 5);
    expect(order.meta.refType).toBe('LIMIT');
  });

  it('falls back to taker when makerPreferred edge fails', () => {
    const marks$ = new Subject<MarketTick>();
    const signals$ = new Subject<StrategySignal>();
    const intents: any[] = [];

    const build = createIntentBuilder({
      account: 'ACC',
      policy: {
        mode: 'makerPreferred',
        defaultQty: 1,
        limitOffsetBps: 10,
        minEdgeBps: 5,
        makerFeeBps: 5,
        adverseSelectionBps: 90,
        takerFeeBps: 2,
        takerSlipBps: 1,
        tif: 'IOC'
      }
    });

    build(signals$, marks$).subscribe((o) => intents.push(o));

    marks$.next({ t: 1, symbol: 'SOLUSDT', bid: 10, ask: 10.05, last: 10.02 });
    // Maker edge fails (adverse selection requirements), taker passes
    signals$.next({ symbol: 'SOLUSDT', action: 'BUY', px: 10.06, t: 2 });

    expect(intents).toHaveLength(1);
    expect(intents[0].type).toBe('MKT');
    expect(intents[0].meta.reason).toBe('MAKER_FALLBACK_TAKER');
  });

  it('applies cooldown and dedupe windows', () => {
    const marks$ = new Subject<MarketTick>();
    const signals$ = new Subject<StrategySignal>();
    const intents: any[] = [];
    const timestamps = [0, 500, 1500, 2500];

    const build = createIntentBuilder({
      account: 'ACC',
      policy: {
        mode: 'market',
        defaultQty: 1,
        minEdgeBps: 0,
        takerFeeBps: 0,
        takerSlipBps: 0,
        cooldownMs: 1000,
        dedupeWindowMs: 2000,
        tif: 'IOC'
      },
      now: () => timestamps.shift() ?? 5000
    });

    build(signals$, marks$).subscribe((o) => intents.push(o));

    marks$.next({ t: 1, symbol: 'XRPUSDT', bid: 0.5, ask: 0.51 });

    const emit = () => signals$.next({ symbol: 'XRPUSDT', action: 'SELL', px: 0.49, t: Date.now() });

    emit();
    expect(intents).toHaveLength(1);
    emit();
    expect(intents).toHaveLength(1);
    emit();
    expect(intents).toHaveLength(1);
    emit();
    expect(intents).toHaveLength(2);
  });

  it('annotates intents with the strategy id when provided', () => {
    const marks$ = new Subject<MarketTick>();
    const signals$ = new Subject<StrategySignal>();
    const intents: any[] = [];

    const build = createIntentBuilder({
      account: 'ACC',
      strategyId: 'strat-demo',
      policy: {
        mode: 'market',
        defaultQty: 1,
        minEdgeBps: 0,
        takerFeeBps: 0,
        takerSlipBps: 0,
        tif: 'IOC'
      }
    });

    build(signals$, marks$).subscribe((order) => intents.push(order));

    marks$.next({ t: 1, symbol: 'BTCUSDT', bid: 100, ask: 100.2 });
    signals$.next({ symbol: 'BTCUSDT', action: 'BUY', px: 101, t: 2 });

    expect(intents).toHaveLength(1);
    expect(intents[0]?.meta?.strategyId).toBe('strat-demo');
  });
});
