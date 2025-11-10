import { describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import { multiFeedMomentumStrategy } from './multiFeedMomentum';
import type { StrategySignal } from '../types';

const tick = (price: number): MarketTick => ({
  t: Date.now(),
  symbol: 'BTCUSDT',
  bid: price,
  ask: price + 0.1,
  last: price
});

describe('multiFeedMomentumStrategy', () => {
  const bullishReversal = [104, 103, 102, 103, 104, 105];
  const bearishReversal = [95, 96, 97, 96, 95, 94];

  it('emits a signal when both feeds agree within the window', () => {
    const primary$ = new Subject<MarketTick>();
    const confirm$ = new Subject<MarketTick>();
    const signals: string[] = [];

    multiFeedMomentumStrategy(
      [
        { id: 'binance', feed$: primary$ },
        { id: 'hyperliquid', feed$: confirm$ }
      ],
      { symbol: 'BTCUSDT', fastWindow: 2, slowWindow: 3 }
    ).subscribe((signal) => signals.push(`${signal.action}@${signal.px.toFixed(2)}`));

    bullishReversal.forEach((price, idx) => {
      primary$.next(tick(price));
      confirm$.next(tick(price + (idx % 2 === 0 ? 0.25 : 0.5)));
    });

    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]?.startsWith('BUY')).toBe(true);
  });

  it('requires consensus before emitting', () => {
    const primary$ = new Subject<MarketTick>();
    const confirm$ = new Subject<MarketTick>();
    const signals: string[] = [];

    multiFeedMomentumStrategy(
      [
        { id: 'binance', feed$: primary$ },
        { id: 'hyperliquid', feed$: confirm$ }
      ],
      { symbol: 'BTCUSDT', fastWindow: 2, slowWindow: 3, minConsensus: 2 }
    ).subscribe((signal) => signals.push(signal.action));

    // Only primary feed signals momentum; secondary stays flat.
    bullishReversal.forEach((price) => primary$.next(tick(price)));
    new Array(bullishReversal.length).fill(100).forEach((price) => confirm$.next(tick(price)));

    expect(signals).toHaveLength(0);
  });

  it('can emit SELL consensus when both feeds reverse lower', () => {
    const primary$ = new Subject<MarketTick>();
    const confirm$ = new Subject<MarketTick>();
    const actions: StrategySignal['action'][] = [];

    multiFeedMomentumStrategy(
      [
        { id: 'binance', feed$: primary$ },
        { id: 'hyperliquid', feed$: confirm$ }
      ],
      { symbol: 'BTCUSDT', fastWindow: 2, slowWindow: 3 }
    ).subscribe((signal) => actions.push(signal.action));

    bearishReversal.forEach((price, idx) => {
      primary$.next(tick(price));
      confirm$.next(tick(price - (idx % 2 === 0 ? 0.2 : 0.35)));
    });

    expect(actions).toContain('SELL');
  });

  it('drops stale secondary feeds when skew exceeds threshold', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    let currentTime = 0;
    const advance = (ms: number) => {
      currentTime += ms;
    };
    nowSpy.mockImplementation(() => currentTime);

    const runScenario = (skewLastFeed: boolean) => {
      const primary$ = new Subject<MarketTick>();
      const confirm$ = new Subject<MarketTick>();
      const actions: StrategySignal['action'][] = [];

      multiFeedMomentumStrategy(
        [
          { id: 'binance', feed$: primary$ },
          { id: 'hyperliquid', feed$: confirm$ }
        ],
        {
          symbol: 'BTCUSDT',
          fastWindow: 2,
          slowWindow: 3,
          maxSkewMs: 200,
          maxSignalAgeMs: 10_000,
          minActionIntervalMs: 0
        }
      ).subscribe((signal) => actions.push(signal.action));

      currentTime = 0;
      bullishReversal.forEach((price) => {
        advance(10);
        primary$.next(tick(price));
        const delay = skewLastFeed ? 400 : 10;
        advance(delay);
        confirm$.next(tick(price + 0.15));
      });

      return actions;
    };

    const baseline = runScenario(false);
    expect(baseline.length).toBeGreaterThan(0);

    const skewed = runScenario(true);
    expect(skewed).toHaveLength(0);

    nowSpy.mockRestore();
  });
});
