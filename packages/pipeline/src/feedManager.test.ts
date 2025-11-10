import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { firstValueFrom, of, take } from 'rxjs';
import { createFeedManager, createFeedAdapter } from './feedManager';
import { FeedType } from '@rx-trader/core/constants';
import { __resetFeedHealthRegistryForTests } from './feedHealth';
import type { MarketTick } from '@rx-trader/core';
import * as feedManagerModule from './feedManager';

class StubAdapter {
  public feed$;
  public id: string;
  private hooks?: any;

  constructor(symbol: string, index: number) {
    const suffix = index ? `-${index}` : '';
    this.id = `feed-${symbol}${suffix}`;
    const tick: MarketTick = {
      t: Date.now(),
      symbol,
      bid: 100,
      ask: 100.1
    };
    this.feed$ = of(tick);
  }

  connect() {
    this.hooks?.onStatusChange?.('connected');
    this.hooks?.onTick?.(Date.now());
  }

  setLifecycleHooks(hooks: any) {
    this.hooks = hooks;
  }
}

import type { SpyInstance } from 'vitest';
let adapterSpy: SpyInstance;
const originalCreateFeedAdapter = createFeedAdapter;

beforeEach(() => {
  adapterSpy = vi
    .spyOn(feedManagerModule, 'createFeedAdapter')
    .mockImplementation((kind, symbol: string, index = 0) => {
      if (kind === FeedType.Binance || kind === FeedType.Hyperliquid) {
        return new StubAdapter(symbol, index) as any;
      }
      return originalCreateFeedAdapter(kind, symbol, index);
    });
});

afterEach(() => {
  __resetFeedHealthRegistryForTests();
  adapterSpy?.mockRestore();
});

describe('createFeedManager', () => {
  it('builds feed sources and emits ticks from the primary feed', async () => {
    const onTick = vi.fn();
    const manager = createFeedManager({
      symbol: 'BTCUSDT',
      primaryFeed: FeedType.Binance,
      extraFeeds: [FeedType.Hyperliquid],
      onTick
    });
    expect(manager.sources).toHaveLength(2);
    const tick = await firstValueFrom(manager.marks$.pipe(take(1)));
    expect(tick.symbol).toBe('BTCUSDT');
    expect(onTick).toHaveBeenCalled();
  });

  it('throws for unsupported feed types', () => {
    expect(() =>
      createFeedManager({ symbol: 'SIM', primaryFeed: 'unsupported' as FeedType })
    ).toThrow(/unsupported feed/i);
  });

  it('wires feed health metrics', async () => {
    const feedStatusSet = vi.fn();
    const feedReconnectsInc = vi.fn();
    const feedTickAgeSet = vi.fn();

    const metrics = {
      feedStatus: { set: feedStatusSet },
      feedReconnects: { inc: feedReconnectsInc },
      feedTickAge: { set: feedTickAgeSet }
    } as any;

    const manager = createFeedManager({
      symbol: 'BTCUSDT',
      primaryFeed: FeedType.Binance,
      metrics
    });

    await firstValueFrom(manager.marks$.pipe(take(1)));
    expect(feedStatusSet).toHaveBeenCalled();
    const lastTickCall = feedTickAgeSet.mock.calls.at(-1);
    expect(lastTickCall?.[0]).toEqual({ feed: 'feed-BTCUSDT' });
  });
});
