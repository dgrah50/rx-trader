import { describe, expect, it, vi, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { z } from 'zod';
import type { MarketTick } from '@rx-trader/core/domain';
import { StrategyType, FeedType } from '@rx-trader/core/constants';
import { createStrategy$ } from './strategyManager';
import * as feedModule from './feedManager';

afterEach(() => {
  vi.restoreAllMocks();
});

const makeFeedManager = () => ({
  marks$: new Subject<MarketTick>().asObservable(),
  sources: [
    {
      id: 'primary',
      stream: new Subject<MarketTick>().asObservable(),
      adapter: {
        id: 'primary-adapter',
        feed$: new Subject<MarketTick>().asObservable(),
        connect: vi.fn()
      }
    }
  ]
});

describe('createStrategy$', () => {
  it('resolves definition schema and passes parsed params', () => {
    const feedManager = makeFeedManager();
    const output$ = new Subject().asObservable();
    const createMock = vi.fn(() => output$);
    const schema = z.object({ foo: z.string().default('bar') });

    const result$ = createStrategy$({
      strategy: {
        type: StrategyType.Momentum,
        tradeSymbol: 'BTCUSDT',
        primaryFeed: FeedType.Binance,
        extraFeeds: [],
        params: {}
      },
      feedManager,
      resolveStrategy: () => ({
        type: StrategyType.Momentum,
        schema,
        create: createMock
      } as any)
    });

    expect(result$).toBe(output$);
    expect(createMock).toHaveBeenCalledTimes(1);
    const calls = createMock.mock.calls as unknown as [any, any][];
    const [ctx, params] = calls[0] ?? [];
    expect(ctx).toBeDefined();
    if (!ctx) throw new Error('definition not invoked');
    expect(ctx.tradeSymbol).toBe('BTCUSDT');
    expect(ctx.feedSources).toHaveLength(1);
    expect(params).toEqual({ foo: 'bar' });
  });

  it('creates external feeds that trigger tick callbacks', () => {
    const feedManager = makeFeedManager();
    const schema = z.object({});
    const createMock = vi.fn((ctx) => {
      const external = ctx.createExternalFeed(FeedType.Binance, 'ETHUSDT');
      external.feed$.subscribe(() => {});
      return new Subject().asObservable();
    });
    const externalSubject = new Subject<MarketTick>();
    vi.spyOn(feedModule, 'createFeedAdapter').mockReturnValue({
      id: 'external',
      feed$: externalSubject.asObservable(),
      connect: vi.fn()
    } as any);

    const externalTick = vi.fn();
    createStrategy$({
      strategy: {
        type: StrategyType.Pair,
        tradeSymbol: 'BTCUSDT',
        primaryFeed: FeedType.Binance,
        extraFeeds: [],
        params: {}
      },
      feedManager,
      onExternalFeedTick: externalTick,
      resolveStrategy: () => ({
        type: StrategyType.Pair,
        schema,
        create: createMock
      } as any)
    });

    externalSubject.next({ t: Date.now(), symbol: 'ETHUSDT', bid: 1 } as MarketTick);
    expect(externalTick).toHaveBeenCalled();
  });
});
