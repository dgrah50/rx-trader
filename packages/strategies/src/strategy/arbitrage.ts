import { combineLatest, filter, map } from 'rxjs';
import type { Observable } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import { FeedType } from '@rx-trader/core/constants';
import type { StrategySignal } from '../types';
import { toPricePoints, type PricePoint, type PriceSource, withSignalCooldown } from '../utils';

export interface ArbitrageStrategyConfig {
  symbol: string;
  primaryVenue: FeedType;
  secondaryVenue: FeedType;
  spreadBps: number;
  maxAgeMs: number;
  minIntervalMs: number;
  priceSource?: PriceSource;
}

interface VenuePrice extends PricePoint {
  venue: FeedType;
}

const inferVenueSymbol = (symbol: string, venue: FeedType): string => {
  const upper = symbol.toUpperCase();
  if (venue === FeedType.Hyperliquid && upper.endsWith('USDT')) {
    return upper.slice(0, -4);
  }
  return upper;
};

const toVenuePrices = (
  feed$: Observable<MarketTick>,
  symbol: string,
  venue: FeedType,
  priceSource?: PriceSource
): Observable<VenuePrice> =>
  toPricePoints(inferVenueSymbol(symbol, venue), priceSource)(feed$).pipe(
    map((pt) => ({ ...pt, venue }))
  );

const computeSpreadBps = (primary: VenuePrice, secondary: VenuePrice): number | null => {
  if (!primary.px) {
    return null;
  }
  return ((secondary.px - primary.px) / primary.px) * 10_000;
};

const buildSignal = (
  primary: VenuePrice,
  secondary: VenuePrice,
  config: ArbitrageStrategyConfig
): StrategySignal | null => {
  const age = Math.abs(primary.t - secondary.t);
  if (age > config.maxAgeMs) {
    return null;
  }

  const spreadBps = computeSpreadBps(primary, secondary);
  if (spreadBps === null || !Number.isFinite(spreadBps)) {
    return null;
  }

  if (Math.abs(spreadBps) < config.spreadBps) {
    return null;
  }

  const action = spreadBps > 0 ? 'BUY' : 'SELL';
  const timestamp = Math.max(primary.t, secondary.t);

  return {
    symbol: config.symbol,
    action,
    px: primary.px,
    t: timestamp
  };
};

export const arbitrageStrategy = (
  primaryFeed$: Observable<MarketTick>,
  secondaryFeed$: Observable<MarketTick>,
  config: ArbitrageStrategyConfig
): Observable<StrategySignal> => {
  if (config.primaryVenue === config.secondaryVenue) {
    throw new Error('Arbitrage strategy requires two distinct venues');
  }

  const primary$ = toVenuePrices(
    primaryFeed$,
    config.symbol,
    config.primaryVenue,
    config.priceSource
  );
  const secondary$ = toVenuePrices(
    secondaryFeed$,
    config.symbol,
    config.secondaryVenue,
    config.priceSource
  );

  return combineLatest([primary$, secondary$]).pipe(
    map(([primary, secondary]) => buildSignal(primary, secondary, config)),
    filter((signal): signal is StrategySignal => signal !== null),
    withSignalCooldown(config.minIntervalMs)
  );
};
