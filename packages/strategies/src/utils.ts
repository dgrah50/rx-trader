import type { Observable } from 'rxjs';
import { bufferCount, distinctUntilChanged, filter, map, pairwise, scan } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import type { StrategySignal } from './types';

/**
 * How to derive a price from a tick.
 */
export type PriceSource = 'last' | 'mid' | 'bid' | 'ask';

export interface PricePoint {
  symbol: string;
  px: number;
  t: number;
}

/**
 * Generic "current plus history" wrapper.
 */
interface WithHistory<T> {
  current: T;
  history: T[];
}

/**
 * Basic z-score point for any numeric series.
 */
interface ZScorePoint {
  value: number;
  mean: number;
  std: number;
  z: number;
}

/**
 * Crossover direction: fast vs slow.
 */
type CrossoverDirection = 'CROSS_ABOVE' | 'CROSS_BELOW';

export interface CrossoverEvent {
  direction: CrossoverDirection;
  t: number;
}

/* -------------------------------------------------------------------------- */
/*                               Math utilities                               */
/* -------------------------------------------------------------------------- */

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

const variance = (values: number[], m?: number): number => {
  if (!values.length) return 0;
  const mu = m ?? mean(values);
  return (
    values.reduce((sum, v) => {
      const d = v - mu;
      return sum + d * d;
    }, 0) / values.length
  );
};

const stdDev = (values: number[], m?: number): number => Math.sqrt(variance(values, m));

/* -------------------------------------------------------------------------- */
/*                           Tick / price normalization                       */
/* -------------------------------------------------------------------------- */

/**
 * Extract a numeric price from a MarketTick using a chosen convention.
 * Tries to be robust and fall back if the preferred field is missing.
 */
export const priceFromTick = (
  tick: MarketTick,
  source: PriceSource = 'last',
): number | undefined => {
  const { bid, ask, last } = tick;

  const mid = bid !== undefined && ask !== undefined ? (bid + ask) / 2 : undefined;

  switch (source) {
    case 'last':
      return last ?? mid ?? bid ?? ask;
    case 'mid':
      return mid ?? last ?? bid ?? ask;
    case 'bid':
      return bid ?? last ?? mid ?? ask;
    case 'ask':
      return ask ?? last ?? mid ?? bid;
    default:
      return last ?? mid ?? bid ?? ask;
  }
};

/**
 * Filter a tick stream down to a single symbol.
 */
export const filterSymbol =
  (symbol: string) =>
  (source$: Observable<MarketTick>): Observable<MarketTick> =>
    source$.pipe(filter((tick) => tick.symbol === symbol));

/**
 * Map a tick stream to normalized PricePoint objects for a specific symbol.
 */
export const toPricePoints =
  (symbol: string, source: PriceSource = 'last') =>
  (ticks$: Observable<MarketTick>): Observable<PricePoint> =>
    ticks$.pipe(
      filter((tick) => tick.symbol === symbol),
      map((tick): PricePoint | null => {
        const px = priceFromTick(tick, source);
        if (px === undefined) return null;
        return {
          symbol,
          px,
          t: tick.t ?? Date.now(),
        };
      }),
      filter((pt): pt is PricePoint => pt !== null),
    );

/* -------------------------------------------------------------------------- */
/*                           Windowing / history ops                          */
/* -------------------------------------------------------------------------- */

/**
 * Generic sliding window over a stream.
 * Equivalent to bufferCount(windowSize, step).
 */
export const slidingWindow =
  <T>(windowSize: number, step = 1) =>
  (source$: Observable<T>): Observable<T[]> =>
    source$.pipe(
      bufferCount(windowSize, step),
      filter((window) => window.length === windowSize),
    );

/**
 * Attach a history window (including the current item) to each emission.
 * history = previous N-1 items, current = latest item.
 */
export const withHistory =
  <T>(windowSize: number) =>
  (source$: Observable<T>): Observable<WithHistory<T>> =>
    source$.pipe(
      scan((window, value) => [...window, value].slice(-windowSize), [] as T[]),
      map((window) => {
        const current = window[window.length - 1] as T;
        const history = window.slice(0, -1);
        return { current, history };
      }),
    );

/**
 * Apply a projection to each sliding window.
 */
const rollingMap =
  <T, R>(windowSize: number, project: (window: T[]) => R, step = 1) =>
  (source$: Observable<T>): Observable<R> =>
    source$.pipe(slidingWindow<T>(windowSize, step), map(project));

/* -------------------------------------------------------------------------- */
/*                     Price-series & numeric-series ops                      */
/* -------------------------------------------------------------------------- */

/**
 * Simple moving average over a numeric stream.
 */
export const sma =
  (windowSize: number) =>
  (source$: Observable<number>): Observable<number> =>
    source$.pipe(rollingMap(windowSize, mean));

/**
 * Exponential moving average over a numeric stream.
 * α default is the standard 2/(N+1).
 */
export const ema =
  (period: number, alpha?: number) =>
  (source$: Observable<number>): Observable<number> => {
    if (period <= 0) {
      throw new Error('EMA period must be positive');
    }
    const a = alpha ?? 2 / (period + 1);

    return source$.pipe(
      scan(
        (state, value) => {
          const emaVal = state.ema === undefined ? value : a * value + (1 - a) * state.ema;
          return { ema: emaVal };
        },
        { ema: undefined as number | undefined },
      ),
      map((s) => s.ema as number),
    );
  };

/**
 * Simple or log returns from a price stream.
 *
 * simple: (p_t / p_{t-1}) - 1
 * log:    ln(p_t / p_{t-1})
 */
export const returns =
  (mode: 'simple' | 'log' = 'simple') =>
  (source$: Observable<number>): Observable<number> =>
    source$.pipe(
      pairwise(),
      map(([prev, curr]) => {
        if (prev === 0) return 0;
        const ratio = curr / prev;
        if (mode === 'simple') return ratio - 1;
        return Math.log(ratio);
      }),
    );

/**
 * Rolling standard deviation over a numeric stream.
 */
export const rollingStdDev =
  (windowSize: number) =>
  (source$: Observable<number>): Observable<number> =>
    source$.pipe(rollingMap(windowSize, (window) => stdDev(window) || 0));

/**
 * Rolling z-score over a numeric stream.
 * Emits { value, mean, std, z } where value is the last item in the window.
 */
export const rollingZScore =
  (windowSize: number) =>
  (source$: Observable<number>): Observable<ZScorePoint> =>
    source$.pipe(
      rollingMap(windowSize, (window): ZScorePoint => {
        const value = window[window.length - 1] as number;
        const m = mean(window);
        const s = stdDev(window, m) || 1e-12;
        return {
          value,
          mean: m,
          std: s,
          z: (value - m) / s,
        };
      }),
    );

/**
 * Rolling min/max over a numeric stream.
 */
interface MinMaxPoint {
  min: number;
  max: number;
}

export const rollingMinMax =
  (windowSize: number) =>
  (source$: Observable<number>): Observable<MinMaxPoint> =>
    source$.pipe(
      rollingMap(
        windowSize,
        (window): MinMaxPoint => ({
          min: Math.min(...window),
          max: Math.max(...window),
        }),
      ),
    );

/* -------------------------------------------------------------------------- */
/*                         Crossover / momentum helpers                       */
/* -------------------------------------------------------------------------- */

/**
 * Detect crossovers between fast and slow series.
 *
 * Input: { fast, slow, t? }
 * Output: CrossoverEvent when fast crosses above/below slow.
 */
export const detectCrossovers =
  () =>
  (source$: Observable<{ fast: number; slow: number; t?: number }>): Observable<CrossoverEvent> =>
    source$.pipe(
      pairwise(),
      map(([prev, curr]): CrossoverEvent | null => {
        const prevDiff = prev.fast - prev.slow;
        const currDiff = curr.fast - curr.slow;

        if (prevDiff <= 0 && currDiff > 0) {
          // fast crosses above slow
          return {
            direction: 'CROSS_ABOVE',
            t: curr.t ?? Date.now(),
          };
        }

        if (prevDiff >= 0 && currDiff < 0) {
          // fast crosses below slow
          return {
            direction: 'CROSS_BELOW',
            t: curr.t ?? Date.now(),
          };
        }

        return null;
      }),
      filter((ev): ev is CrossoverEvent => ev !== null),
    );

/* -------------------------------------------------------------------------- */
/*                          StrategySignal utilities                          */
/* -------------------------------------------------------------------------- */

/**
 * Drop consecutive identical actions (BUY->BUY, SELL->SELL) to reduce churn.
 * Still allows BUY->SELL or SELL->BUY flips.
 */
export const dedupeConsecutiveSignals =
  () =>
  (source$: Observable<StrategySignal>): Observable<StrategySignal> =>
    source$.pipe(distinctUntilChanged((prev, curr) => prev.action === curr.action));

/**
 * Enforce a minimum time between emitted signals (cooldown).
 * Uses signal.t if present, otherwise Date.now().
 */
export const withSignalCooldown =
  (minIntervalMs: number) =>
  (source$: Observable<StrategySignal>): Observable<StrategySignal> =>
    source$.pipe(
      scan(
        (state, signal) => {
          const now = signal.t ?? Date.now();
          const canEmit = now - state.lastEmitTs >= minIntervalMs;

          if (canEmit) {
            return {
              lastEmitTs: now,
              last: signal,
              output: signal,
            };
          }

          return {
            lastEmitTs: state.lastEmitTs,
            last: state.last,
            output: null,
          };
        },
        {
          lastEmitTs: Number.NEGATIVE_INFINITY,
          last: null as StrategySignal | null,
          output: null as StrategySignal | null,
        },
      ),
      map((s) => s.output),
      filter((sig): sig is StrategySignal => sig !== null),
    );

/**
 * Restrict signals to a given symbol (handy when composing multi-symbol engines).
 */
export const filterSignalSymbol =
  (symbol: string) =>
  (source$: Observable<StrategySignal>): Observable<StrategySignal> =>
    source$.pipe(filter((sig) => sig.symbol === symbol));

/**
 * Map BUY/SELL signals to a signed position intent (+1 / -1).
 * Useful as a first step toward position management & PnL.
 */
export const signalToSignedIntent =
  (size: number = 1) =>
  (source$: Observable<StrategySignal>): Observable<{ t: number; symbol: string; size: number }> =>
    source$.pipe(
      map((sig) => ({
        t: sig.t,
        symbol: sig.symbol,
        size: sig.action === 'BUY' ? +size : -size,
      })),
    );

/* -------------------------------------------------------------------------- */
/*                     Convenience pipelines for ticks                        */
/* -------------------------------------------------------------------------- */

/**
 * Build a normalized price stream (numbers only) from MarketTicks.
 * This is often the starting point for indicators:
 *
 * ticks$ |> priceSeries('BTCUSDT') |> sma(20) |> ...
 */
export const priceSeries =
  (symbol: string, source: PriceSource = 'last') =>
  (ticks$: Observable<MarketTick>): Observable<number> =>
    ticks$.pipe(
      filter((tick) => tick.symbol === symbol),
      map((tick) => priceFromTick(tick, source)),
      filter((px): px is number => px !== undefined),
    );

/**
 * Price → returns → rolling vol (stddev of returns).
 * This is intentionally un-annualized; you can scale externally based
 * on your bar frequency (e.g. sqrt(252) for daily).
 */
export const rollingVolFromPrices =
  (windowSize: number, mode: 'simple' | 'log' = 'simple') =>
  (prices$: Observable<number>): Observable<number> =>
    prices$.pipe(returns(mode), rollingStdDev(windowSize));
