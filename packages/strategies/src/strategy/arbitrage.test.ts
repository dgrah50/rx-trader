import { describe, expect, it } from 'vitest';
import { Subject } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import { FeedType } from '@rx-trader/core/constants';
import { arbitrageStrategy, type ArbitrageStrategyConfig } from './arbitrage';

const defaultConfig: ArbitrageStrategyConfig = {
  symbol: 'BTCUSDT',
  primaryVenue: FeedType.Binance,
  secondaryVenue: FeedType.Hyperliquid,
  spreadBps: 10,
  maxAgeMs: 1_000,
  minIntervalMs: 1_000,
  priceSource: 'last'
};

const makeTick = (symbol: string, price: number, ts: number): MarketTick => ({
  symbol,
  t: ts,
  last: price,
  bid: price - 0.1,
  ask: price + 0.1
});

const pushPair = (
  primary$: Subject<MarketTick>,
  secondary$: Subject<MarketTick>,
  primaryPrice: number,
  secondaryPrice: number,
  primaryTs: number,
  secondaryTs: number = primaryTs
) => {
  primary$.next(makeTick('BTCUSDT', primaryPrice, primaryTs));
  secondary$.next(makeTick('BTC', secondaryPrice, secondaryTs));
};

describe('arbitrageStrategy', () => {
  it('emits BUY when secondary venue trades richer than primary', () => {
    const primary$ = new Subject<MarketTick>();
    const secondary$ = new Subject<MarketTick>();
    const actions: string[] = [];

    const sub = arbitrageStrategy(primary$, secondary$, defaultConfig).subscribe((signal) => {
      actions.push(signal.action);
    });

    pushPair(primary$, secondary$, 100, 101, 1_000);

    expect(actions).toEqual(['BUY']);
    sub.unsubscribe();
  });

  it('emits SELL when secondary venue trades cheaper than primary', () => {
    const primary$ = new Subject<MarketTick>();
    const secondary$ = new Subject<MarketTick>();
    const actions: string[] = [];

    const sub = arbitrageStrategy(primary$, secondary$, defaultConfig).subscribe((signal) => {
      actions.push(signal.action);
    });

    pushPair(primary$, secondary$, 101, 100, 2_000);

    expect(actions).toEqual(['SELL']);
    sub.unsubscribe();
  });

  it('ignores signals when ticks are stale relative to maxAgeMs', () => {
    const primary$ = new Subject<MarketTick>();
    const secondary$ = new Subject<MarketTick>();
    const actions: string[] = [];

    const sub = arbitrageStrategy(primary$, secondary$, defaultConfig).subscribe((signal) => {
      actions.push(signal.action);
    });

    pushPair(primary$, secondary$, 100, 102, 1_000, 5_500);

    expect(actions).toHaveLength(0);
    sub.unsubscribe();
  });

  it('respects cooldown between repeated opportunities', () => {
    const primary$ = new Subject<MarketTick>();
    const secondary$ = new Subject<MarketTick>();
    const actions: string[] = [];

    const sub = arbitrageStrategy(primary$, secondary$, {
      ...defaultConfig,
      minIntervalMs: 1_000
    }).subscribe((signal) => {
      actions.push(`${signal.action}@${signal.t}`);
    });

    pushPair(primary$, secondary$, 100, 101, 1_000);
    pushPair(primary$, secondary$, 100, 101.5, 1_500);
    pushPair(primary$, secondary$, 100, 101.5, 2_500);

    expect(actions).toEqual(['BUY@1000', 'BUY@2500']);
    sub.unsubscribe();
  });
});
