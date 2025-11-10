const toLookup = <T extends string>(values: readonly T[]) =>
  values.reduce<Record<string, T>>((acc, value) => {
    acc[value.toLowerCase()] = value;
    return acc;
  }, {});

const parseEnumValue = <T extends string>(
  raw: string,
  lookup: Record<string, T>,
  label: string
): T => {
  const normalized = raw.toLowerCase();
  const value = lookup[normalized];
  if (!value) {
    throw new Error(`Unsupported ${label}: "${raw}"`);
  }
  return value;
};

export enum FeedType {
  Binance = 'binance',
  Hyperliquid = 'hyperliquid'
}

export enum StrategyType {
  Momentum = 'momentum',
  Pair = 'pair',
  Arbitrage = 'arbitrage'
}

export enum ExecutionVenue {
  Paper = 'paper',
  Binance = 'binance',
  Hyperliquid = 'hyperliquid'
}

const FEED_LOOKUP = toLookup(Object.values(FeedType));
const STRATEGY_LOOKUP = toLookup(Object.values(StrategyType));

export const parseFeedType = (value: string): FeedType =>
  parseEnumValue(value, FEED_LOOKUP, 'feed type');

export const parseStrategyType = (value: string): StrategyType =>
  parseEnumValue(value, STRATEGY_LOOKUP, 'strategy type');
