import { FeedType, StrategyType } from '@rx-trader/core/constants';
import type { ExitConfig } from './strategy-exits.schema';

export interface StrategyPreset {
  id: string;
  type: StrategyType;
  tradeSymbol: string;
  primaryFeed: FeedType;
  extraFeeds?: FeedType[];
  mode?: 'live' | 'sandbox';
  priority?: number;
  params?: Record<string, unknown>;
  budget?: {
    notional?: number;
    maxPosition?: number;
    throttle?: { windowMs: number; maxCount: number };
  };
  exit: ExitConfig;
}

const demoExitConfig: ExitConfig = {
  enabled: true,
  tpSl: { enabled: true, tpSigma: 1.4, slSigma: 0.9, sigmaLookbackSec: 120, asymmetric: false },
  fairValue: { enabled: true, epsilonBps: 6, closeOnSignalFlip: true },
  time: { enabled: true, maxHoldMs: 180_000, minHoldMs: 10_000 },
  trailing: { enabled: true, retracePct: 0.35, initArmPnLs: 0.6 },
};

export const DEFAULT_STRATEGIES: StrategyPreset[] = [
  {
    id: 'momentum-main',
    type: StrategyType.Momentum,
    tradeSymbol: 'BTCUSDT',
    primaryFeed: FeedType.Binance,
    extraFeeds: [],
    mode: 'live',
    priority: 10,
    params: {
      fastWindow: 5,
      slowWindow: 20,
      minConsensus: 1,
      maxSignalAgeMs: 2_000,
      minActionIntervalMs: 1_000,
    },
    budget: {
      notional: 250_000,
      maxPosition: 2,
      throttle: { windowMs: 1_000, maxCount: 20 },
    },
    exit: demoExitConfig,
  },
  {
    id: 'arb-binance-hl',
    type: StrategyType.Arbitrage,
    tradeSymbol: 'BTCUSDT',
    primaryFeed: FeedType.Binance,
    extraFeeds: [FeedType.Hyperliquid],
    mode: 'live',
    priority: 6,
    params: {
      primaryVenue: FeedType.Binance,
      secondaryVenue: FeedType.Hyperliquid,
      spreadBps: 3,
      maxAgeMs: 3_000,
      minIntervalMs: 200,
      priceSource: 'mid',
      maxSkewBps: 15,
      sizeBps: 25,
      minEdgeBps: 1,
    },
    budget: {
      notional: 150_000,
      maxPosition: 2,
      throttle: { windowMs: 500, maxCount: 4 },
    },
    exit: {
      ...demoExitConfig,
      time: { enabled: true, maxHoldMs: 90_000, minHoldMs: 5_000 },
    },
  },
];

export const DEFAULT_STRATEGIES_JSON = JSON.stringify(DEFAULT_STRATEGIES);
