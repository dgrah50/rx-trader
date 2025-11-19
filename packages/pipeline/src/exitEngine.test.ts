import { describe, expect, it } from 'vitest';
import { Subject } from 'rxjs';
import { createExitEngine } from './exitEngine';
import type { ExitConfig } from '@rx-trader/config';
import type { PortfolioAnalytics, PortfolioSnapshot, OrderNew } from '@rx-trader/core/domain';
import type { PricePoint, StrategySignal } from '@rx-trader/strategies';
import { createManualClock, systemClock } from '@rx-trader/core/time';

const basePosition = (
  pos: number,
  avgPx: number,
  t = Date.now()
): PortfolioSnapshot['positions'][string] => ({
  t,
  symbol: 'BTCUSDT',
  pos,
  px: avgPx,
  avgPx,
  unrealized: 0,
  netRealized: 0,
  grossRealized: 0,
  notional: pos * avgPx,
  pnl: 0
});

const emptyAnalytics: PortfolioAnalytics = {
  t: Date.now(),
  nav: 1000,
  pnl: 0,
  realized: 0,
  netRealized: 0,
  grossRealized: 0,
  unrealized: 0,
  cash: 1000,
  peakNav: 1000,
  drawdown: 0,
  drawdownPct: 0,
  feesPaid: 0,
  symbols: {}
};

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createExitEngine', () => {
  const makeStreams = () => {
    const positions$ = new Subject<PortfolioSnapshot['positions'][string] | null>();
    const price$ = new Subject<PricePoint>();
    const signals$ = new Subject<StrategySignal>();
    const analytics$ = new Subject<PortfolioAnalytics>();
    return { positions$, price$, signals$, analytics$ };
  };

  const emitPrices = (price$: Subject<PricePoint>, values: number[]) => {
    values.forEach((px, idx) => {
      price$.next({ symbol: 'BTCUSDT', px, t: Date.now() + idx });
    });
  };

  it('emits TP exits when sigma thresholds are met', async () => {
    const exitConfig: ExitConfig = {
      enabled: true,
      logVerbose: false,
      tpSl: {
        enabled: true,
        tpSigma: 0.1,
        slSigma: 5,
        sigmaLookbackSec: 10,
        asymmetric: false
      }
    };
    const { positions$, price$, signals$, analytics$ } = makeStreams();
    const clock = createManualClock(0);
    const handle = createExitEngine({
      strategyId: 'strat-1',
      symbol: 'BTCUSDT',
      accountId: 'ACC',
      exit: exitConfig,
      clock,
      positions$,
      price$,
      signals$,
      analytics$
    });

    const orders: OrderNew[] = [];
    handle.exitIntents$.subscribe((order) => orders.push(order));

    analytics$.next(emptyAnalytics);
    positions$.next(basePosition(0.01, 100, clock.now()));
    emitPrices(price$, [100, 100.5, 101, 101.5, 102]);
    price$.next({ symbol: 'BTCUSDT', px: 110, t: Date.now() });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(orders).toHaveLength(1);
    expect(orders[0]?.side).toBe('SELL');
    expect(orders[0]?.qty).toBeCloseTo(0.01);
    handle.stop();
  });

  it('triggers time-based exits after max hold', async () => {
    const exitConfig: ExitConfig = {
      enabled: true,
      logVerbose: false,
      time: {
        enabled: true,
        maxHoldMs: 1_000
      }
    };
    const { positions$, price$, signals$, analytics$ } = makeStreams();
    const clock = createManualClock(0);
    const handle = createExitEngine({
      strategyId: 'strat-2',
      symbol: 'BTCUSDT',
      accountId: 'ACC',
      exit: exitConfig,
      clock,
      positions$,
      price$,
      signals$,
      analytics$
    });

    const orders: OrderNew[] = [];
    handle.exitIntents$.subscribe((order) => orders.push(order));
    analytics$.next(emptyAnalytics);
    price$.next({ symbol: 'BTCUSDT', px: 100, t: 0 });
    positions$.next(basePosition(0.02, 100, clock.now()));
    clock.advance(1_500);
    price$.next({ symbol: 'BTCUSDT', px: 100.1, t: 1_500 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(orders).toHaveLength(1);
    expect(orders[0]?.meta?.reason).toBe('EXIT_TIME');
    handle.stop();
  });

  it('triggers time exits via internal poller without new ticks', async () => {
    const exitConfig: ExitConfig = {
      enabled: true,
      logVerbose: false,
      time: {
        enabled: true,
        maxHoldMs: 120,
        pollIntervalMs: 40
      }
    };
    const { positions$, price$, signals$, analytics$ } = makeStreams();
    const handle = createExitEngine({
      strategyId: 'strat-2b',
      symbol: 'BTCUSDT',
      accountId: 'ACC',
      exit: exitConfig,
      clock: systemClock,
      positions$,
      price$,
      signals$,
      analytics$
    });

    const orders: OrderNew[] = [];
    handle.exitIntents$.subscribe((order) => orders.push(order));
    analytics$.next(emptyAnalytics);
    price$.next({ symbol: 'BTCUSDT', px: 100, t: 0 });
    positions$.next(basePosition(0.05, 100, Date.now()));

    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushMicrotasks();
    expect(orders).toHaveLength(1);
    expect(orders[0]?.meta?.reason).toBe('EXIT_TIME');
    handle.stop();
  });

  it('responds to signal flips when configured', async () => {
    const exitConfig: ExitConfig = {
      enabled: true,
      logVerbose: false,
      fairValue: {
        enabled: true,
        closeOnSignalFlip: true,
        epsilonBps: 0
      }
    };
    const { positions$, price$, signals$, analytics$ } = makeStreams();
    const clock = createManualClock(0);
    const handle = createExitEngine({
      strategyId: 'strat-3',
      symbol: 'BTCUSDT',
      accountId: 'ACC',
      exit: exitConfig,
      clock,
      positions$,
      price$,
      signals$,
      analytics$
    });
    const orders: OrderNew[] = [];
    handle.exitIntents$.subscribe((order) => orders.push(order));
    analytics$.next(emptyAnalytics);
    positions$.next(basePosition(0.01, 100, clock.now()));
    price$.next({ symbol: 'BTCUSDT', px: 100, t: 0 });
    signals$.next({ symbol: 'BTCUSDT', action: 'BUY', px: 100, t: 0 });
    signals$.next({ symbol: 'BTCUSDT', action: 'SELL', px: 100, t: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(orders).toHaveLength(1);
    expect(orders[0]?.side).toBe('SELL');
    handle.stop();
  });

  it('emits exits when risk overrides breach exposure limits', async () => {
    const exitConfig: ExitConfig = {
      enabled: true,
      logVerbose: false,
      riskOverrides: {
        maxSymbolExposureUsd: 500,
        action: 'FLATTEN_SYMBOL'
      }
    };
    const { positions$, price$, signals$, analytics$ } = makeStreams();
    const clock = createManualClock(0);
    const handle = createExitEngine({
      strategyId: 'risk-test',
      symbol: 'BTCUSDT',
      accountId: 'ACC',
      exit: exitConfig,
      clock,
      positions$,
      price$,
      signals$,
      analytics$
    });

    const orders: OrderNew[] = [];
    handle.exitIntents$.subscribe((order) => orders.push(order));
    analytics$.next({
      ...emptyAnalytics,
      symbols: {
        BTCUSDT: {
          symbol: 'BTCUSDT',
          pos: 5,
          avgPx: 100,
          markPx: 105,
          realized: 0,
          netRealized: 0,
          grossRealized: 0,
          unrealized: 0,
          notional: 525
        }
      }
    });
    positions$.next(basePosition(5, 105, clock.now()));
    price$.next({ symbol: 'BTCUSDT', px: 105, t: 0 });
    await flushMicrotasks();
    expect(orders).toHaveLength(1);
    expect(orders[0]?.meta?.reason).toBe('EXIT_RISK_SYMBOL');
    expect(orders[0]?.side).toBe('SELL');
    handle.stop();
  });

  it('fires trailing stop after arming on favorable move', async () => {
    const exitConfig: ExitConfig = {
      enabled: true,
      logVerbose: false,
      trailing: {
        enabled: true,
        retracePct: 0.05,
        initArmPnLs: 0.0001
      }
    };
    const { positions$, price$, signals$, analytics$ } = makeStreams();
    const clock = createManualClock(0);
    const handle = createExitEngine({
      strategyId: 'trail-test',
      symbol: 'BTCUSDT',
      accountId: 'ACC',
      exit: exitConfig,
      clock,
      positions$,
      price$,
      signals$,
      analytics$
    });

    const orders: OrderNew[] = [];
    handle.exitIntents$.subscribe((order) => orders.push(order));
    analytics$.next(emptyAnalytics);
    positions$.next(basePosition(1, 100, clock.now()));
    emitPrices(price$, [100, 103, 106]); // build sigma + favorable move
    price$.next({ symbol: 'BTCUSDT', px: 95, t: Date.now() + 4 });
    await flushMicrotasks();
    expect(orders).toHaveLength(1);
    expect(orders[0]?.meta?.reason).toBe('EXIT_TRAIL');
    expect(orders[0]?.side).toBe('SELL');
    handle.stop();
  });

  it('exits when price converges to fair value within epsilon', async () => {
    const exitConfig: ExitConfig = {
      enabled: true,
      logVerbose: false,
      fairValue: {
        enabled: true,
        epsilonBps: 5,
        closeOnSignalFlip: false
      }
    };
    const { positions$, price$, signals$, analytics$ } = makeStreams();
    const clock = createManualClock(0);
    const handle = createExitEngine({
      strategyId: 'fv-test',
      symbol: 'BTCUSDT',
      accountId: 'ACC',
      exit: exitConfig,
      clock,
      positions$,
      price$,
      signals$,
      analytics$
    });

    const orders: OrderNew[] = [];
    handle.exitIntents$.subscribe((order) => orders.push(order));
    analytics$.next(emptyAnalytics);
    positions$.next(basePosition(0.5, 100, clock.now()));
    signals$.next({ symbol: 'BTCUSDT', action: 'BUY', px: 100, t: clock.now() });
    price$.next({ symbol: 'BTCUSDT', px: 100.03, t: clock.now() });
    await flushMicrotasks();
    expect(orders).toHaveLength(1);
    expect(orders[0]?.meta?.reason).toBe('EXIT_FAIR_VALUE');
    handle.stop();
  });

  it('maps FLATTEN_ALL overrides to exits using current direction', async () => {
    const exitConfig: ExitConfig = {
      enabled: true,
      logVerbose: false,
      riskOverrides: {
        maxGrossExposureUsd: 100,
        action: 'FLATTEN_ALL'
      }
    };
    const { positions$, price$, signals$, analytics$ } = makeStreams();
    const clock = createManualClock(0);
    const handle = createExitEngine({
      strategyId: 'flatten-test',
      symbol: 'BTCUSDT',
      accountId: 'ACC',
      exit: exitConfig,
      clock,
      positions$,
      price$,
      signals$,
      analytics$
    });

    const orders: OrderNew[] = [];
    handle.exitIntents$.subscribe((order) => orders.push(order));
    analytics$.next({
      ...emptyAnalytics,
      symbols: {
        BTCUSDT: {
          symbol: 'BTCUSDT',
          pos: 2,
          avgPx: 100,
          markPx: 100,
          realized: 0,
          netRealized: 0,
          grossRealized: 0,
          unrealized: 0,
          notional: 200
        }
      }
    });
    positions$.next(basePosition(2, 100, clock.now()));
    price$.next({ symbol: 'BTCUSDT', px: 100, t: clock.now() });
    await flushMicrotasks();
    expect(orders).toHaveLength(1);
    expect(orders[0]?.meta?.reason).toBe('EXIT_RISK_GROSS');
    expect(orders[0]?.side).toBe('SELL');
    handle.stop();
  });
});
