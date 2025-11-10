import { describe, expect, it } from 'vitest';
import { Subject } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import { pairsMeanReversionStrategy } from './pairsMeanReversion';

const tick = (symbol: string, price: number): MarketTick => ({
  t: Date.now(),
  symbol,
  bid: price,
  ask: price + 0.1,
  last: price
});

describe('pairsMeanReversionStrategy', () => {
  it('emits BUY when ratio drops below threshold', () => {
    const btc$ = new Subject<MarketTick>();
    const eth$ = new Subject<MarketTick>();
    const signals: string[] = [];

    pairsMeanReversionStrategy(btc$, eth$, {
      tradeSymbol: 'BTCUSDT',
      baseSymbol: 'BTCUSDT',
      quoteSymbol: 'ETHUSDT',
      window: 3,
      entryZ: 1,
      exitZ: 0.5,
      minIntervalMs: 0
    }).subscribe((signal) => signals.push(signal.action));

    // Start with ratio near 1
    [1, 1, 1].forEach((ratio, idx) => {
      btc$.next(tick('BTCUSDT', 100 + idx));
      eth$.next(tick('ETHUSDT', 100 + idx));
    });

    // Drop BTC price to drive ratio lower
    btc$.next(tick('BTCUSDT', 95));
    eth$.next(tick('ETHUSDT', 100));

    expect(signals).toContain('BUY');
  });

  it('emits SELL when ratio spikes above threshold', () => {
    const btc$ = new Subject<MarketTick>();
    const eth$ = new Subject<MarketTick>();
    const signals: string[] = [];

    pairsMeanReversionStrategy(btc$, eth$, {
      tradeSymbol: 'BTCUSDT',
      baseSymbol: 'BTCUSDT',
      quoteSymbol: 'ETHUSDT',
      window: 3,
      entryZ: 1,
      exitZ: 0.5,
      minIntervalMs: 0
    }).subscribe((signal) => signals.push(signal.action));

    [1, 1, 1].forEach((ratio, idx) => {
      btc$.next(tick('BTCUSDT', 100 + idx));
      eth$.next(tick('ETHUSDT', 100 + idx));
    });

    btc$.next(tick('BTCUSDT', 110));
    eth$.next(tick('ETHUSDT', 100));

    expect(signals).toContain('SELL');
  });
});
