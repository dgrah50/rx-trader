import { filter, map, pairwise } from 'rxjs';
import type { Observable } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import type { StrategySignal } from '../types';
import { priceSeries } from '../utils';

interface BenchmarkPulseConfig {
  symbol: string;
  minDeltaBps?: number;
}

const bpsFrom = (prev: number, curr: number) => ((curr - prev) / prev) * 10_000;

/**
 * Benchmark helper strategy that emits an intent on nearly every tick.
 * Direction follows the most-recent price delta to stress downstream stages.
 */
export const benchmarkPulseStrategy = (
  ticks$: Observable<MarketTick>,
  config: BenchmarkPulseConfig
): Observable<StrategySignal> => {
  const minDeltaBps = config.minDeltaBps ?? 0;
  const prices$ = priceSeries(config.symbol)(ticks$);

  return prices$.pipe(
    pairwise(),
    map(([prev, curr]): StrategySignal | null => {
      const deltaBps = bpsFrom(prev, curr);
      if (Math.abs(deltaBps) < minDeltaBps) {
        return null;
      }
      return {
        symbol: config.symbol,
        action: deltaBps >= 0 ? 'BUY' : 'SELL',
        px: curr,
        t: Date.now()
      };
    }),
    filter((signal): signal is StrategySignal => signal !== null)
  );
};
