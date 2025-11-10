import { combineLatest, scan, filter, map, shareReplay } from 'rxjs';
import type { Observable } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import type { StrategySignal } from '../types';

const extractPrice = (tick: MarketTick) => tick.last ?? tick.bid ?? tick.ask;

interface PairsMeanReversionConfig {
  tradeSymbol: string;
  baseSymbol: string;
  quoteSymbol: string;
  window: number;
  entryZ: number;
  exitZ: number;
  minIntervalMs?: number;
}

interface RatioPoint {
  ratio: number;
  tradePx: number;
  ts: number;
}

interface PairsState {
  ratios: RatioPoint[];
  lastAction: StrategySignal['action'] | null;
  lastEmitTs: number;
}

const defaultPairsState: PairsState = {
  ratios: [],
  lastAction: null,
  lastEmitTs: 0
};

export const pairsMeanReversionStrategy = (
  base$: Observable<MarketTick>,
  quote$: Observable<MarketTick>,
  config: PairsMeanReversionConfig
): Observable<StrategySignal> => {
  const windowSize = Math.max(2, config.window);
  const entryZ = config.entryZ;
  const exitZ = config.exitZ;
  const minIntervalMs = config.minIntervalMs ?? 1_000;

  const ratio$ = combineLatest([base$, quote$]).pipe(
    map(([base, quote]): RatioPoint | null => {
      if (
        base.symbol !== config.baseSymbol ||
        quote.symbol !== config.quoteSymbol
      ) {
        return null;
      }
      const basePx = extractPrice(base);
      const quotePx = extractPrice(quote);
      if (basePx === undefined || quotePx === undefined || quotePx === 0) {
        return null;
      }
      return { ratio: basePx / quotePx, tradePx: basePx, ts: base.t };
    }),
    filter((point): point is RatioPoint => point !== null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  return ratio$.pipe(
    scan((state, point) => {
      const nextRatios = [...state.ratios, point].slice(-windowSize);
      let signal: StrategySignal | null = null;

      if (nextRatios.length === windowSize) {
        const values = nextRatios.map((r) => r.ratio);
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const variance =
          values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / values.length;
        const std = Math.sqrt(variance) || 1e-9;
        const z = (point.ratio - mean) / std;
        const now = point.ts ?? Date.now();
        const intervalOk = now - state.lastEmitTs >= minIntervalMs;

        if (intervalOk) {
          if (z > entryZ && state.lastAction !== 'SELL') {
            signal = {
              symbol: config.tradeSymbol,
              action: 'SELL',
              px: point.tradePx,
              t: now
            };
          } else if (z < -entryZ && state.lastAction !== 'BUY') {
            signal = {
              symbol: config.tradeSymbol,
              action: 'BUY',
              px: point.tradePx,
              t: now
            };
          } else if (Math.abs(z) < exitZ) {
            state.lastAction = null;
          }
        }
      }

      return {
        ratios: nextRatios,
        lastAction: signal ? signal.action : state.lastAction,
        lastEmitTs: signal ? point.ts : state.lastEmitTs,
        signal
      } satisfies PairsState & { signal: StrategySignal | null };
    }, defaultPairsState as PairsState & { signal?: StrategySignal | null }),
    map((state) => state.signal ?? null),
    filter((signal): signal is StrategySignal => signal !== null)
  );
};
