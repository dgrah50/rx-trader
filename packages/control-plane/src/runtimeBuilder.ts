import type { StartEngineOptions } from './startEngine';
import { loadConfig, type EnvOverrides } from '@rx-trader/config';
import { createLogger, createMetrics } from '@rx-trader/observability';
import { createEventStore, createPersistenceManager, persistenceWorkerUrl } from '@rx-trader/event-store';
import {
  createFeedManager,
  createStrategy$,
  createRiskStreams,
  createExecutionManager
} from '@rx-trader/pipeline';
import { FeedType } from '@rx-trader/core/constants';
import { createMarketStructureStore, MarketStructureRepository } from '@rx-trader/market-structure';
import type { Metrics } from '@rx-trader/observability/metrics';
import { createIntentBuilder } from '@rx-trader/strategies';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';
import { createAccountState } from '@rx-trader/portfolio';
import type { AccountStateHandle } from '@rx-trader/portfolio';
import type { InstrumentMetadata } from '@rx-trader/pipeline';

const feedTypeToExchange = (feed: FeedType): string | null => {
  switch (feed) {
    case FeedType.Binance:
      return 'binance';
    case FeedType.Hyperliquid:
      return 'hyperliquid';
    default:
      return null;
  }
};

type EventStoreInstance = Awaited<ReturnType<typeof createEventStore>>;

export interface RuntimeBuilderResult {
  config: ReturnType<typeof loadConfig>;
  store: EventStoreInstance;
  metrics: Metrics;
  feedManager: ReturnType<typeof createFeedManager>;
  persistence: ReturnType<typeof createPersistenceManager>;
  signals$: ReturnType<typeof createStrategy$>;
  execution: ReturnType<typeof createExecutionManager>;
  riskStreams: ReturnType<typeof createRiskStreams>;
  marketStore: ReturnType<typeof createMarketStructureStore>;
  logger: ReturnType<typeof createLogger>;
  accountState: AccountStateHandle;
  instrument: InstrumentMetadata;
}

export interface RuntimeDependencies {
  createFeedManager?: typeof createFeedManager;
  createExecutionManager?: typeof createExecutionManager;
  createEventStore?: typeof createEventStore;
  createPersistenceManager?: typeof createPersistenceManager;
  createIntentBuilder?: typeof createIntentBuilder;
  createStrategy$?: typeof createStrategy$;
}

export const buildRuntime = async (
  options: StartEngineOptions = {},
  deps: RuntimeDependencies = {}
): Promise<RuntimeBuilderResult> => {
  const live = options.live ?? false;
  const config = loadConfig(options.configOverrides as EnvOverrides | undefined);
  const clock: Clock = options.clock ?? systemClock;
  const boundClock: Clock = { now: clock.now.bind(clock) };
  const logger = createLogger('trader', undefined, clock);
  const metrics = createMetrics();
  const eventStoreFactory = deps.createEventStore ?? createEventStore;
  const store = await eventStoreFactory(config, metrics);

  const marketStore = createMarketStructureStore(config.marketStructure.sqlitePath);
  const marketRepository = new MarketStructureRepository(marketStore.db);

  const persistenceFactory = deps.createPersistenceManager ?? createPersistenceManager;
  const persistence = persistenceFactory({
    store,
    logger,
    workerPath: persistenceWorkerUrl.href,
    envSnapshot: Object.fromEntries(Object.entries(process.env)),
    metrics,
    queueCapacity: config.persistence.queueCapacity,
    queueHighWatermarkRatio: 0.85,
    queueSampleIntervalMs: 1000
  });
  const accountState = await createAccountState(store);

  const { strategy, risk } = config;
  let tradeSymbol = strategy.tradeSymbol;
  const exchangeCode = feedTypeToExchange(strategy.primaryFeed);
  let baseAsset: string | undefined;
  let quoteAsset: string | undefined;
  let contractType: string | undefined;
  if (exchangeCode) {
    const marketPair = await marketRepository.getExchangePair(exchangeCode, strategy.tradeSymbol);
    if (!marketPair) {
      logger.warn(
        { exchange: exchangeCode, symbol: strategy.tradeSymbol },
        'Market structure missing; using configured symbol as-is'
      );
    } else {
      tradeSymbol = marketPair.exchangePair.exchSymbol;
      // Base/quote symbols are not directly denormalized here; we infer below if needed.
      contractType = marketPair.exchangePair.contractType;
      logger.info(
        { exchange: exchangeCode, symbol: tradeSymbol },
        'Loaded market structure pair definition'
      );
    }
  }

  const resolvedStrategy = { ...strategy, tradeSymbol };
  if (!risk.priceBands[tradeSymbol] && risk.priceBands[strategy.tradeSymbol]) {
    risk.priceBands[tradeSymbol] = risk.priceBands[strategy.tradeSymbol];
  }
  if (!baseAsset || !quoteAsset) {
    const inferred = inferBaseQuote(strategy.tradeSymbol);
    if (inferred) {
      baseAsset = baseAsset ?? inferred.base;
      quoteAsset = quoteAsset ?? inferred.quote;
    }
  }

  const feedManagerFactory = deps.createFeedManager ?? createFeedManager;
  const feedManager = feedManagerFactory({
    symbol: tradeSymbol,
    primaryFeed: resolvedStrategy.primaryFeed,
    extraFeeds: resolvedStrategy.extraFeeds,
    onTick: () => metrics.ticksIngested.inc()
  });

  const strategyFactory = deps.createStrategy$ ?? createStrategy$;
  const signals$ = strategyFactory({
    strategy: resolvedStrategy,
    feedManager,
    onExternalFeedTick: () => metrics.ticksIngested.inc()
  });

  let tickSize: number | undefined;
  let lotSize: number | undefined;
  if (exchangeCode) {
    const ms = await marketRepository.getExchangePair(exchangeCode, tradeSymbol);
    tickSize = ms?.exchangePair.tickSize ?? undefined;
    lotSize = ms?.exchangePair.lotSize ?? undefined;
  }

  const intentBuilderFactory = deps.createIntentBuilder ?? createIntentBuilder;
  const buildIntents = intentBuilderFactory({
    account: config.execution.account,
    policy: config.execution.policy as any,
    tickSize,
    lotSize,
    now: boundClock.now
  });

  const intents$ = buildIntents(signals$, feedManager.marks$);
  const accountGuard =
    accountState && baseAsset && quoteAsset
      ? {
          venue: exchangeCode ?? 'paper',
          baseAsset,
          quoteAsset,
          getAvailable: (venue: string, asset: string) =>
            accountState.getBalance(venue, asset)?.available ?? null
        }
      : undefined;

  const riskStreams = createRiskStreams(
    intents$,
    {
      notional: risk.notional,
      maxPosition: risk.maxPosition,
      priceBands: risk.priceBands,
      throttle: risk.throttle
    },
    boundClock,
    accountGuard
  );

  const executionFactory = deps.createExecutionManager ?? createExecutionManager;
  const execution = executionFactory({
    live,
    config,
    enqueue: persistence.enqueue,
    clock,
    metrics,
    logger
  });

  return {
    config,
    store,
    metrics,
    feedManager,
    persistence,
    signals$,
    execution,
    riskStreams,
    marketStore,
    logger,
    accountState,
    instrument: {
      symbol: resolvedStrategy.tradeSymbol,
      venue: exchangeCode ?? 'paper',
      baseAsset,
      quoteAsset,
      contractType
    }
  };
};

const inferBaseQuote = (symbol: string): { base: string; quote: string } | null => {
  const upper = symbol.toUpperCase();
  const candidates = ['USDT', 'USD', 'USDC', 'BTC', 'ETH', 'BNB', 'EUR', 'JPY'];
  for (const quote of candidates) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return { base: upper.slice(0, -quote.length), quote };
    }
  }
  return null;
};
