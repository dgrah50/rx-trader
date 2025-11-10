import { filter, map, pairwise } from 'rxjs';
import type { Observable } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import { dedupeConsecutiveSignals, priceSeries, withHistory } from '../utils';
import type { StrategySignal, StrategyAction } from '../types';
type InternalAction = StrategyAction | 'HOLD';

const average = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

export interface MomentumStrategyConfig {
  symbol: string;
  fastWindow: number;
  slowWindow: number;
}

export const simpleMomentumStrategy = (
  ticks$: Observable<MarketTick>,
  config: MomentumStrategyConfig
): Observable<StrategySignal> => {
  if (config.fastWindow <= 0 || config.slowWindow <= 0) {
    throw new Error('Window sizes must be positive integers');
  }
  if (config.fastWindow >= config.slowWindow) {
    throw new Error('fastWindow must be smaller than slowWindow');
  }

  const prices$ = priceSeries(config.symbol)(ticks$);
  const state$ = prices$.pipe(
    withHistory(config.slowWindow),
    map(({ current, history }) => {
      const window = [...history.slice(-(config.slowWindow - 1)), current];
      if (window.length < config.slowWindow) {
        return null;
      }
      const fastSlice = window.slice(-config.fastWindow);
      if (fastSlice.length < config.fastWindow) {
        return null;
      }

      return {
        px: current,
        fast: average(fastSlice),
        slow: average(window),
        t: Date.now()
      };
    }),
    filter((state): state is { px: number; fast: number; slow: number; t: number } => state !== null)
  );

  return state$.pipe(
    pairwise(),
    map(([prev, curr]): StrategySignal | null => {
      const prevDiff = prev.fast - prev.slow;
      const currDiff = curr.fast - curr.slow;
      let action: InternalAction | null = null;

      if (prevDiff <= 0 && currDiff > 0) {
        action = 'BUY';
      } else if (prevDiff >= 0 && currDiff < 0) {
        action = 'SELL';
      }

      if (!action) return null;

      return {
        symbol: config.symbol,
        action,
        px: curr.px,
        t: curr.t
      };
    }),
    filter((signal): signal is StrategySignal => signal !== null),
    dedupeConsecutiveSignals()
  );
};
