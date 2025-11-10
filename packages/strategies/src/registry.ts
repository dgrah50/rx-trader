import { share, tap } from 'rxjs';
import type { Observable } from 'rxjs';
import { z } from 'zod';
import type { MarketTick } from '@rx-trader/core/domain';
import { FeedType, StrategyType } from '@rx-trader/core/constants';
import {
  simpleMomentumStrategy,
  multiFeedMomentumStrategy,
  pairsMeanReversionStrategy,
  arbitrageStrategy
} from './strategy';
import type { StrategySignal } from './types';

export interface StrategyFeedSource {
  id: string;
  feed$: Observable<MarketTick>;
}

export interface StrategyContext {
  tradeSymbol: string;
  feedSources: StrategyFeedSource[];
  marks$: Observable<MarketTick>;
  createExternalFeed: (type: FeedType, symbol: string, idSuffix?: number) => StrategyFeedSource;
  onExternalFeedTick?: () => void;
}

interface StrategyDefinition<TParams extends Record<string, unknown>> {
  type: StrategyType;
  schema: z.ZodType<TParams>;
  defaults: TParams;
  create: (context: StrategyContext, params: TParams) => Observable<StrategySignal>;
}

const momentumSchema = z.object({
  fastWindow: z.number().int().positive(),
  slowWindow: z.number().int().positive(),
  minConsensus: z.number().int().positive(),
  maxSignalAgeMs: z.number().int().nonnegative(),
  minActionIntervalMs: z.number().int().nonnegative()
});

const momentumDefaults: MomentumParams = {
  fastWindow: 3,
  slowWindow: 5,
  minConsensus: 2,
  maxSignalAgeMs: 2_000,
  minActionIntervalMs: 1_000
};

type MomentumParams = z.infer<typeof momentumSchema>;

const pairSchema = z.object({
  pairSymbol: z.string().min(3),
  pairFeed: z.nativeEnum(FeedType),
  window: z.number().int().positive(),
  entryZ: z.number().positive(),
  exitZ: z.number().positive(),
  minIntervalMs: z.number().int().nonnegative()
});

const pairDefaults: PairParams = {
  pairSymbol: 'ETHUSDT',
  pairFeed: FeedType.Binance,
  window: 50,
  entryZ: 1.5,
  exitZ: 0.5,
  minIntervalMs: 1_000
};

type PairParams = z.infer<typeof pairSchema>;

const priceSourceEnum = z.enum(['last', 'mid', 'bid', 'ask']);

const arbitrageSchema = z
  .object({
    primaryVenue: z.nativeEnum(FeedType),
    secondaryVenue: z.nativeEnum(FeedType),
    spreadBps: z.number().positive(),
    maxAgeMs: z.number().int().nonnegative(),
    minIntervalMs: z.number().int().nonnegative(),
    priceSource: priceSourceEnum
  })
  .superRefine((value, ctx) => {
    if (value.primaryVenue === value.secondaryVenue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondaryVenue'],
        message: 'Arbitrage strategy requires two distinct venues'
      });
    }
  });

type ArbitrageParams = z.infer<typeof arbitrageSchema>;

const arbitrageDefaults: ArbitrageParams = {
  primaryVenue: FeedType.Binance,
  secondaryVenue: FeedType.Hyperliquid,
  spreadBps: 10,
  maxAgeMs: 1_000,
  minIntervalMs: 1_000,
  priceSource: 'last'
};

const momentumDefinition: StrategyDefinition<MomentumParams> = {
  type: StrategyType.Momentum,
  schema: momentumSchema,
  defaults: momentumDefaults,
  create: (context, params) => {
    if (!context.feedSources.length) {
      throw new Error('momentum strategy requires at least one feed');
    }

    if (context.feedSources.length > 1) {
      const consensus = Math.min(context.feedSources.length, params.minConsensus);
      return multiFeedMomentumStrategy(
        context.feedSources.map((source) => ({ id: source.id, feed$: source.feed$ })),
        {
          symbol: context.tradeSymbol,
          fastWindow: params.fastWindow,
          slowWindow: params.slowWindow,
          minConsensus: consensus,
          maxSignalAgeMs: params.maxSignalAgeMs,
          minActionIntervalMs: params.minActionIntervalMs
        }
      );
    }

    return simpleMomentumStrategy(context.marks$, {
      symbol: context.tradeSymbol,
      fastWindow: params.fastWindow,
      slowWindow: params.slowWindow
    });
  }
};

const pairDefinition: StrategyDefinition<PairParams> = {
  type: StrategyType.Pair,
  schema: pairSchema,
  defaults: pairDefaults,
  create: (context, params) => {
    const pairSource = context.createExternalFeed(params.pairFeed, params.pairSymbol);
    const pair$ = pairSource.feed$.pipe(
      share(),
      tap(() => context.onExternalFeedTick?.())
    );

    return pairsMeanReversionStrategy(context.marks$, pair$, {
      tradeSymbol: context.tradeSymbol,
      baseSymbol: context.tradeSymbol,
      quoteSymbol: params.pairSymbol,
      window: params.window,
      entryZ: params.entryZ,
      exitZ: params.exitZ,
      minIntervalMs: params.minIntervalMs
    });
  }
};

const inferFeedTypeFromId = (id: string): FeedType | null => {
  const normalized = id.toLowerCase();
  if (normalized.startsWith('binance')) {
    return FeedType.Binance;
  }
  if (normalized.startsWith('hyperliquid')) {
    return FeedType.Hyperliquid;
  }
  return null;
};

const arbitrageDefinition: StrategyDefinition<ArbitrageParams> = {
  type: StrategyType.Arbitrage,
  schema: arbitrageSchema,
  defaults: arbitrageDefaults,
  create: (context, params) => {
    const findExisting = (venue: FeedType) =>
      context.feedSources.find((source) => inferFeedTypeFromId(source.id) === venue);

    const ensureFeed = (venue: FeedType, index: number) =>
      findExisting(venue) ?? context.createExternalFeed(venue, context.tradeSymbol, index);

    const primary = ensureFeed(params.primaryVenue, 0);
    const secondary = ensureFeed(params.secondaryVenue, 1);

    return arbitrageStrategy(primary.feed$, secondary.feed$, {
      symbol: context.tradeSymbol,
      primaryVenue: params.primaryVenue,
      secondaryVenue: params.secondaryVenue,
      spreadBps: params.spreadBps,
      maxAgeMs: params.maxAgeMs,
      minIntervalMs: params.minIntervalMs,
      priceSource: params.priceSource
    });
  }
};

const registry: Record<StrategyType, StrategyDefinition<any>> = {
  [StrategyType.Momentum]: momentumDefinition,
  [StrategyType.Pair]: pairDefinition,
  [StrategyType.Arbitrage]: arbitrageDefinition
};

export const getStrategyDefinition = <TParams extends Record<string, unknown>>(
  type: StrategyType
): StrategyDefinition<TParams> => {
  const definition = registry[type];
  if (!definition) {
    throw new Error(`Unsupported strategy type: ${type}`);
  }
  return definition as StrategyDefinition<TParams>;
};
