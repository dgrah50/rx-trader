import { describe, it, expect } from 'vitest';
import { Subject } from 'rxjs';
import type { StrategyRuntime } from './strategyScheduler';
import { createStrategyTelemetry } from './strategyTelemetry';
import { FeedType, StrategyType } from '@rx-trader/core/constants';

const createRuntime = (id: string): {
  runtime: StrategyRuntime;
  signal$: Subject<any>;
  intent$: Subject<any>;
} => {
  const signal$ = new Subject<any>();
  const intent$ = new Subject<any>();
  const runtime: StrategyRuntime = {
    definition: {
      id,
      type: StrategyType.Momentum,
      tradeSymbol: 'BTCUSDT',
      primaryFeed: FeedType.Binance,
      extraFeeds: [],
      params: {},
      mode: 'live',
      priority: 0,
      budget: {}
    },
    mode: 'live',
    priority: 0,
    feedManager: {
      marks$: new Subject<any>(),
      sources: []
    },
    signals$: signal$,
    intents$: intent$,
    fees: { makerBps: 8, takerBps: 10, source: 'test' }
  };
  return { runtime, signal$, intent$ };
};

describe('createStrategyTelemetry', () => {
  it('tracks strategy metrics across signals, intents, orders, fills, and rejects', () => {
    const { runtime, signal$, intent$ } = createRuntime('strat-A');
    const telemetry = createStrategyTelemetry({ runtimes: [runtime] });

    signal$.next({}); // first signal
    signal$.next({}); // second signal
    intent$.next({}); // intent after budget

    const orderId = 'order-1';
    telemetry.recordOrder({
      id: orderId,
      t: Date.now(),
      symbol: 'BTCUSDT',
      side: 'BUY',
      qty: 1,
      type: 'MKT',
      tif: 'DAY',
      account: 'ACC',
      meta: { strategyId: 'strat-A' }
    });

    telemetry.recordFill({
      id: 'fill-1',
      orderId,
      t: Date.now(),
      symbol: 'BTCUSDT',
      px: 100,
      qty: 1,
      side: 'BUY'
    });

    const rejectedOrderId = 'order-2';
    telemetry.recordOrder({
      id: rejectedOrderId,
      t: Date.now(),
      symbol: 'BTCUSDT',
      side: 'SELL',
      qty: 0.5,
      type: 'MKT',
      tif: 'DAY',
      account: 'ACC',
      meta: { strategyId: 'strat-A' }
    });
    telemetry.recordExecutionReject({ id: rejectedOrderId, t: Date.now(), reason: 'cancelled' });

    const snapshot = telemetry.snapshot();
    expect(snapshot).toHaveLength(1);
    const snapshotEntry = snapshot[0]!;
    const metrics = snapshotEntry.metrics;
    expect(metrics.signals).toBe(2);
    expect(metrics.intents).toBe(1);
    expect(metrics.orders).toBe(2);
    expect(metrics.fills).toBe(1);
    expect(metrics.rejects).toBe(1);
    expect(snapshotEntry.fees).toEqual({ makerBps: 8, takerBps: 10, source: 'test' });
  });

  it('uses symbol fallbacks when strategy metadata is missing', () => {
    const { runtime } = createRuntime('strat-B');
    const telemetry = createStrategyTelemetry({ runtimes: [runtime] });

    telemetry.recordRiskReject({
      id: 'order-x',
      t: Date.now(),
      symbol: 'BTCUSDT',
      side: 'SELL',
      qty: 0.5,
      type: 'MKT',
      tif: 'DAY',
      account: 'ACC'
    });

    const metrics = telemetry.snapshot()[0]!.metrics;
    expect(metrics.rejects).toBe(1);
  });

  it('records exit counts and reasons per strategy', () => {
    const { runtime } = createRuntime('strat-exit');
    const telemetry = createStrategyTelemetry({ runtimes: [runtime] });

    telemetry.recordExit('strat-exit', 'EXIT_TIME');
    telemetry.recordExit('strat-exit', 'EXIT_TIME');
    telemetry.recordExit('strat-exit', 'EXIT_TP');

    const snapshot = telemetry.snapshot()[0]!;
    expect(snapshot.exits.total).toBe(3);
    expect(snapshot.exits.byReason.EXIT_TIME).toBe(2);
    expect(snapshot.exits.byReason.EXIT_TP).toBe(1);
    expect(snapshot.exits.lastReason).toBe('EXIT_TP');
    expect(snapshot.exits.lastTs).toBeGreaterThan(0);
  });
});
