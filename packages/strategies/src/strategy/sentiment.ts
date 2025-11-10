import { filter, map } from 'rxjs';
import type { Observable } from 'rxjs';
import type { SentimentSample } from '@rx-trader/core/domain';
import type { StrategySignal } from '../types';

interface SentimentStrategyConfig {
  symbol: string;
  buyThreshold: number;
  sellThreshold: number;
}

export const sentimentStrategy = (
  feed$: Observable<SentimentSample>,
  config: SentimentStrategyConfig
): Observable<StrategySignal> => {
  const { buyThreshold, sellThreshold } = config;
  if (buyThreshold <= sellThreshold) {
    throw new Error('buyThreshold must be greater than sellThreshold');
  }

  return feed$.pipe(
    filter((sample) => sample.symbol === config.symbol),
    map((sample) => {
      if (sample.score >= buyThreshold) {
        return { symbol: sample.symbol, action: 'BUY', px: 0, t: sample.t } as StrategySignal;
      }
      if (sample.score <= sellThreshold) {
        return { symbol: sample.symbol, action: 'SELL', px: 0, t: sample.t } as StrategySignal;
      }
      return null;
    }),
    filter((signal): signal is StrategySignal => signal !== null)
  );
};
