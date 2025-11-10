import { describe, expect, it } from 'vitest';
import { from, lastValueFrom, toArray, take } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import {
  priceSeries,
  priceFromTick,
  detectCrossovers,
  dedupeConsecutiveSignals,
  slidingWindow,
  withHistory,
  returns,
  rollingZScore,
  withSignalCooldown,
  signalToSignedIntent,
  filterSignalSymbol,
  filterSymbol,
  sma,
  ema,
  rollingStdDev,
  rollingMinMax,
  rollingVolFromPrices,
  type CrossoverEvent
} from './utils';
import type { StrategySignal } from './types';

describe('strategy utils DSL', () => {
  it('priceSeries filters ticks by symbol and normalizes price', async () => {
    const tickData: MarketTick[] = [
      { symbol: 'BTCUSDT', t: 1, last: 100 },
      { symbol: 'ETHUSDT', t: 2, last: 200 },
      { symbol: 'BTCUSDT', t: 3, bid: 99, ask: 101 }
    ];
    const ticks = from(tickData);

    const prices = await lastValueFrom(priceSeries('BTCUSDT')(ticks).pipe(toArray()));
    expect(prices).toEqual([100, 100]);
  });

  it('detectCrossovers emits events when fast and slow series cross', async () => {
    const states = from([
      { fast: 0.9, slow: 1 },
      { fast: 1.1, slow: 1 },
      { fast: 1.0, slow: 1.05 },
      { fast: 0.9, slow: 1 }
    ]);

    const events = await lastValueFrom(states.pipe(detectCrossovers(), toArray()));

    expect(events.map((ev: CrossoverEvent) => ev.direction)).toEqual([
      'CROSS_ABOVE',
      'CROSS_BELOW'
    ]);
  });

  it('dedupeConsecutiveSignals drops repeated actions', async () => {
    const actions: StrategySignal[] = [
      { symbol: 'BTCUSDT', action: 'BUY', px: 100, t: 1 },
      { symbol: 'BTCUSDT', action: 'BUY', px: 101, t: 2 },
      { symbol: 'BTCUSDT', action: 'SELL', px: 102, t: 3 },
      { symbol: 'BTCUSDT', action: 'SELL', px: 103, t: 4 },
      { symbol: 'BTCUSDT', action: 'BUY', px: 104, t: 5 }
    ];

    const deduped = await lastValueFrom(from(actions).pipe(dedupeConsecutiveSignals(), toArray()));

    expect(deduped.map((sig) => sig.action)).toEqual(['BUY', 'SELL', 'BUY']);
  });

  it('slidingWindow creates overlapping buffers', async () => {
    const windows = await lastValueFrom(
      from([1, 2, 3, 4]).pipe(slidingWindow<number>(3), take(2), toArray())
    );
    expect(windows).toEqual([
      [1, 2, 3],
      [2, 3, 4]
    ]);
  });

  it('withHistory attaches rolling context', async () => {
    const history = await lastValueFrom(
      from([7, 8, 9]).pipe(withHistory<number>(3), toArray())
    );
    expect(history[2]).toEqual({ current: 9, history: [7, 8] });
  });

  it('returns computes simple and log changes', async () => {
    const source = from([100, 105, 100]);

    const simple = await lastValueFrom(source.pipe(returns('simple'), toArray()));
    const log = await lastValueFrom(from([100, 105, 100]).pipe(returns('log'), toArray()));

    expect(simple[0]).toBeCloseTo(0.05, 5);
    expect(simple[1]).toBeCloseTo(-0.047619, 5);
    expect(log[0]).toBeCloseTo(Math.log(1.05), 5);
    expect(log[1]).toBeCloseTo(Math.log(100 / 105), 5);
  });

  it('priceFromTick falls back between sources', () => {
    const tick: MarketTick = { symbol: 'BTCUSDT', t: 0, bid: 100, ask: 102, last: 101 };
    expect(priceFromTick(tick, 'mid')).toBe(101);
    expect(priceFromTick({ symbol: 'BTCUSDT', t: 1, bid: 100 } as MarketTick, 'ask')).toBe(100);
    expect(priceFromTick({ symbol: 'BTCUSDT', t: 2 } as MarketTick, 'mid')).toBeUndefined();
  });

  it('filterSymbol pipes only the requested symbol', async () => {
    const ticks = from<MarketTick[]>([
      { symbol: 'BTCUSDT', t: 1, last: 100 } as MarketTick,
      { symbol: 'ETHUSDT', t: 2, last: 200 } as MarketTick,
      { symbol: 'BTCUSDT', t: 3, last: 101 } as MarketTick
    ]);
    const filtered = await lastValueFrom(filterSymbol('BTCUSDT')(ticks).pipe(toArray()));
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.last)).toEqual([100, 101]);
  });

  it('rollingZScore emits standardised windows', async () => {
    const z = await lastValueFrom(from([1, 2, 3, 4]).pipe(rollingZScore(3), take(2), toArray()));
    expect(z).toHaveLength(2);
    expect(z[0]?.mean).toBeCloseTo(2, 5);
    expect(z[0]?.z).toBeCloseTo((3 - 2) / Math.sqrt(2 / 3), 5);
  });

  it('withSignalCooldown enforces minimum spacing using timestamps', async () => {
    const signals: StrategySignal[] = [
      { symbol: 'BTCUSDT', action: 'BUY', px: 100, t: 0 },
      { symbol: 'BTCUSDT', action: 'BUY', px: 101, t: 500 },
      { symbol: 'BTCUSDT', action: 'BUY', px: 102, t: 1_500 },
      { symbol: 'BTCUSDT', action: 'SELL', px: 103, t: 2_600 }
    ];

    const cooled = await lastValueFrom(
      from(signals).pipe(withSignalCooldown(1_000), toArray())
    );

    expect(cooled.map((sig) => `${sig.action}@${sig.t}`)).toEqual([
      'BUY@0',
      'BUY@1500',
      'SELL@2600'
    ]);
  });

  it('signalToSignedIntent converts actions to signed sizes and filterSignalSymbol scopes symbols', async () => {
    const signals: StrategySignal[] = [
      { symbol: 'BTCUSDT', action: 'BUY', px: 100, t: 0 },
      { symbol: 'ETHUSDT', action: 'SELL', px: 200, t: 1 }
    ];

    const intents = await lastValueFrom(
      from(signals)
        .pipe(filterSignalSymbol('BTCUSDT'))
        .pipe(signalToSignedIntent(2), toArray())
    );

    expect(intents).toEqual([{ symbol: 'BTCUSDT', size: 2, t: 0 }]);
  });

  it('sma and ema produce rolling averages', async () => {
    const smaValues = await lastValueFrom(from([1, 2, 3, 4]).pipe(sma(2), toArray()));
    expect(smaValues).toEqual([1.5, 2.5, 3.5]);

    const emaValues = await lastValueFrom(from([1, 2, 3]).pipe(ema(2), toArray()));
    expect(emaValues[0]).toBe(1);
    expect(emaValues[1]).toBeCloseTo(1.6667, 4);
    expect(emaValues[2]).toBeCloseTo(2.5556, 4);
  });

  it('rollingStdDev and rollingMinMax capture window statistics', async () => {
    const std = await lastValueFrom(from([1, 2, 3, 4]).pipe(rollingStdDev(3), toArray()));
    expect(std).toHaveLength(2);
    std.forEach((value) => expect(value).toBeCloseTo(0.816, 3));

    const extremes = await lastValueFrom(
      from([1, 3, 2, 5]).pipe(rollingMinMax(2), toArray())
    );
    expect(extremes).toEqual([
      { min: 1, max: 3 },
      { min: 2, max: 3 },
      { min: 2, max: 5 }
    ]);
  });

  it('rollingVolFromPrices composes returns and volatility', async () => {
    const vols = await lastValueFrom(
      from([100, 102, 101, 103]).pipe(rollingVolFromPrices(2), toArray())
    );
    expect(vols.length).toBeGreaterThan(0);
    vols.forEach((value) => expect(value).toBeGreaterThanOrEqual(0));
  });
});
