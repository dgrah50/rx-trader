import { share, tap } from 'rxjs';
import type { Observable } from 'rxjs';
import type { MarketTick } from '@rx-trader/core';
import { BinanceFeedAdapter, HyperliquidFeedAdapter, type FeedAdapter } from '@rx-trader/feeds';
import { FeedType } from '@rx-trader/core/constants';
import type { Metrics } from '@rx-trader/observability/metrics';
import { FeedHealthTracker } from './feedHealth';

export interface FeedSource {
  id: string;
  stream: Observable<MarketTick>;
  adapter: FeedAdapter;
}

interface FeedManagerOptions {
  symbol: string;
  primaryFeed: FeedType;
  extraFeeds?: FeedType[];
  onTick?: () => void;
  metrics?: Metrics;
}

export interface FeedManagerResult {
  marks$: Observable<MarketTick>;
  sources: FeedSource[];
  stop: () => void;
}

const deriveHyperliquidCoin = (symbol: string) => {
  const upper = symbol.toUpperCase();
  if (upper.endsWith('USDT')) {
    return upper.slice(0, -4);
  }
  return upper;
};

export const createFeedAdapter = (kind: FeedType, symbol: string, index = 0): FeedAdapter => {
  const idSuffix = index ? `-${index}` : '';
  switch (kind) {
    case FeedType.Binance:
      return new BinanceFeedAdapter({ symbol });
    case FeedType.Hyperliquid:
      return new HyperliquidFeedAdapter({ coin: deriveHyperliquidCoin(symbol) });
    default:
      throw new Error(`Unsupported feed type "${kind}"`);
  }
};

export const createFeedManager = (options: FeedManagerOptions): FeedManagerResult => {
  const extraFeeds = options.extraFeeds ?? [];
  const adapters: FeedAdapter[] = [
    createFeedAdapter(options.primaryFeed, options.symbol, 0),
    ...extraFeeds.map((kind, idx) => createFeedAdapter(kind, options.symbol, idx + 1))
  ];

  const trackerEntries = new Map<string, { tracker: FeedHealthTracker; managedInFeed: boolean }>();
  adapters.forEach((adapter, index) => {
    const adapterId = adapter.id ?? `feed-${index}`;
    if (options.metrics) {
      const tracker = new FeedHealthTracker(
        {
          feedStatus: options.metrics.feedStatus,
          feedReconnects: options.metrics.feedReconnects,
          feedTickAge: options.metrics.feedTickAge
        },
        adapterId
      );
      if (typeof adapter.setLifecycleHooks === 'function') {
        adapter.setLifecycleHooks({
          onStatusChange: (status) => tracker.setStatus(status),
          onReconnect: () => tracker.recordReconnect(),
          onTick: (timestamp) => tracker.recordTick(timestamp)
        });
        trackerEntries.set(adapterId, { tracker, managedInFeed: true });
      } else {
        tracker.setStatus('connected');
        trackerEntries.set(adapterId, { tracker, managedInFeed: false });
      }
    }
    adapter.connect();
  });

  const sources: FeedSource[] = adapters.map((adapter, index) => {
    const sourceId = adapter.id ?? `feed-${index}`;
    const trackerEntry = trackerEntries.get(sourceId);
    return {
      id: sourceId,
      adapter,
      stream: adapter.feed$.pipe(
        tap((tick) => {
          options.onTick?.();
          if (trackerEntry && !trackerEntry.managedInFeed) {
            trackerEntry.tracker.recordTick(tick.t ?? Date.now());
          }
        }),
        share()
      )
    };
  });

  if (!sources.length) {
    throw new Error('No feeds configured');
  }

  const debug = process.env.DEBUG_FEEDS === '1';
  const stop = () => {
    adapters.forEach((adapter) => adapter.disconnect?.());
    if (debug) {
      console.log('[feedManager] adapters disconnected');
    }
    trackerEntries.forEach(({ tracker }) => tracker.dispose?.());
    trackerEntries.clear();
  };

  return {
    marks$: sources[0]!.stream,
    sources,
    stop
  };
};
