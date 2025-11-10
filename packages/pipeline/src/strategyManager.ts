import { share, tap } from 'rxjs';
import type { Observable } from 'rxjs';
import {
  getStrategyDefinition,
  type StrategySignal,
  type StrategyContext,
  type StrategyFeedSource
} from '@rx-trader/strategies';
import type { StrategyConfig } from '@rx-trader/config';
import type { FeedManagerResult, FeedSource } from './feedManager';
import { createFeedAdapter } from './feedManager';
import type { FeedType } from '@rx-trader/core/constants';
import { safeParse } from '@rx-trader/core/validation';

interface StrategyRunnerOptions {
  strategy: StrategyConfig;
  feedManager: FeedManagerResult;
  onExternalFeedTick?: () => void;
  resolveStrategy?: typeof getStrategyDefinition;
}

const mapFeedSources = (sources: FeedSource[]): StrategyFeedSource[] =>
  sources.map((source) => ({ id: source.id, feed$: source.stream }));

export const createStrategy$ = (options: StrategyRunnerOptions): Observable<StrategySignal> => {
  const resolveDefinition = options.resolveStrategy ?? getStrategyDefinition;
  const definition = resolveDefinition(options.strategy.type);
  const params = safeParse(definition.schema, {
    ...definition.defaults,
    ...(options.strategy.params ?? {})
  });

  const context: StrategyContext = {
    tradeSymbol: options.strategy.tradeSymbol,
    feedSources: mapFeedSources(options.feedManager.sources),
    marks$: options.feedManager.marks$,
    createExternalFeed: (feedType: FeedType, symbol: string, index = 0) => {
      const adapter = createFeedAdapter(feedType, symbol, index);
      adapter.connect();
      const feed$ = adapter.feed$.pipe(
        tap(() => options.onExternalFeedTick?.()),
        share()
      );
      return { id: adapter.id ?? `feed-${symbol}-${index}`, feed$ };
    },
    onExternalFeedTick: options.onExternalFeedTick
  };

  return definition.create(context, params);
};
