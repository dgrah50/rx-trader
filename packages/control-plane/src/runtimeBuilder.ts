import type { StartEngineOptions } from './startEngine';
import { loadConfig, type EnvOverrides, type StrategyDefinition } from '@rx-trader/config';
import { createLogger, createMetrics } from '@rx-trader/observability';
import { createEventStore, createPersistenceManager, persistenceWorkerUrl } from '@rx-trader/event-store';
import {
  createFeedManager,
  createStrategy$,
  createRiskStreams,
  createExecutionManager,
  createStrategyOrchestrator
} from '@rx-trader/pipeline';
import { FeedType } from '@rx-trader/core/constants';
import { createMarketStructureStore, MarketStructureRepository } from '@rx-trader/market-structure';
import type { Metrics } from '@rx-trader/observability/metrics';
import { createIntentBuilder } from '@rx-trader/strategies';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';
import { createAccountState } from '@rx-trader/portfolio';
import type { AccountStateHandle } from '@rx-trader/portfolio';
import type {
  InstrumentMetadata,
  RuntimeStrategyConfig,
  StrategyRuntime
} from '@rx-trader/pipeline';
import { createQuoteReserveGuard, createMarketExposureGuard } from '@rx-trader/risk';
import { resolveStrategyMarginConfig } from './marginConfig';
import type { AccountExposureGuard } from '@rx-trader/risk/preTrade';

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
  execution: ReturnType<typeof createExecutionManager>;
  riskStreams: ReturnType<typeof createRiskStreams>;
  marketStore: ReturnType<typeof createMarketStructureStore>;
  logger: ReturnType<typeof createLogger>;
  accountState: AccountStateHandle;
  instrument: InstrumentMetadata;
  strategies: RuntimeStrategyConfig[];
  strategyRuntimes: StrategyRuntime[];
  accountGuard?: AccountExposureGuard;
  marginGuard?: ReturnType<typeof createMarketExposureGuard>;
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
  const { risk } = config;
  const clock: Clock = options.clock ?? systemClock;
  const boundClock: Clock = { now: clock.now.bind(clock) };
  const logger = createLogger('trader', undefined, clock);
  const metrics = createMetrics();
  const eventStoreFactory = deps.createEventStore ?? createEventStore;
  const store = await eventStoreFactory(config, metrics);

  const marketStore = createMarketStructureStore(config.marketStructure.sqlitePath);
  const marketRepository = new MarketStructureRepository(marketStore.db);
  const defaultFees = {
    makerBps: config.execution.policy.makerFeeBps,
    takerBps: config.execution.policy.takerBps,
    source: 'default'
  };

  const resolveFees = async (
    exchangeCode: string | null,
    symbol: string,
    productType: string
  ) => {
    if (!exchangeCode || exchangeCode === 'paper') {
      return defaultFees;
    }
    try {
      const schedule =
        (await marketRepository.getFeeSchedule(exchangeCode, symbol, productType)) ??
        (await marketRepository.getFeeSchedule(exchangeCode, '*', productType));
      if (schedule) {
        return {
          makerBps: schedule.makerBps,
          takerBps: schedule.takerBps,
          source: schedule.source ?? 'repository'
        };
      }
    } catch (error) {
      logger.warn(
        { exchange: exchangeCode, symbol, productType, err: (error as Error).message },
        'Fee lookup failed, falling back to defaults'
      );
    }
    return defaultFees;
  };

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

  const runtimeStrategiesBase = await resolveStrategies(
    config.strategies,
    marketRepository,
    logger,
    risk,
    resolveFees
  );

  const runtimeStrategies = runtimeStrategiesBase.map((strategy) => ({
    ...strategy,
    margin: resolveStrategyMarginConfig(strategy.definition, config, strategy.contractType)
  }));

  const primaryStrategy = selectPrimaryStrategy(runtimeStrategies);
  const instrumentVenue = feedTypeToExchange(primaryStrategy.definition.primaryFeed) ?? 'paper';
  const primaryMargin = primaryStrategy.margin ?? resolveStrategyMarginConfig(primaryStrategy.definition, config, primaryStrategy.contractType);

  const accountGuard =
    accountState && primaryStrategy.baseAsset && primaryStrategy.quoteAsset
      ? createQuoteReserveGuard({
          venue: instrumentVenue,
          baseAsset: primaryStrategy.baseAsset,
          quoteAsset: primaryStrategy.quoteAsset,
          getBalance: (venue: string, asset: string) => accountState.getBalance(venue, asset)
        })
      : undefined;

  const feedManagerFactory = deps.createFeedManager ?? createFeedManager;
  const strategyFactory = deps.createStrategy$ ?? createStrategy$;
  const intentBuilderFactory = deps.createIntentBuilder ?? createIntentBuilder;

  const orchestrator = createStrategyOrchestrator({
    strategies: runtimeStrategies,
    executionAccount: config.execution.account,
    executionPolicy: config.execution.policy as any,
    baseRisk: risk,
    clock: boundClock,
    accountGuard,
    createFeedManager: feedManagerFactory,
    createStrategy$: strategyFactory,
    createIntentBuilder: intentBuilderFactory,
    metrics,
    onFeedTick: () => metrics.ticksIngested.inc()
  });

  const marketGuard = createMarketExposureGuard({
    productType: primaryMargin.productType,
    venue: instrumentVenue,
    baseAsset: primaryStrategy.baseAsset ?? inferBaseQuote(primaryStrategy.definition.tradeSymbol)?.base ?? 'BASE',
    quoteAsset: primaryStrategy.quoteAsset ?? inferBaseQuote(primaryStrategy.definition.tradeSymbol)?.quote ?? 'USD',
    leverageCap: primaryMargin.leverageCap,
    getAvailable: (venue: string, asset: string) => accountState.getBalance(venue, asset)?.available ?? 0
  });

  const riskStreams = createRiskStreams(
    orchestrator.intents$,
    {
      notional: risk.notional,
      maxPosition: risk.maxPosition,
      priceBands: risk.priceBands,
      throttle: risk.throttle
    },
    boundClock,
    accountGuard,
    primaryMargin.mode === 'cash' ? undefined : marketGuard
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
    feedManager: orchestrator.feedManager,
    persistence,
    execution,
    riskStreams,
    marketStore,
    logger,
    accountState,
    instrument: {
      symbol: primaryStrategy.definition.tradeSymbol,
      venue: instrumentVenue,
      baseAsset: primaryStrategy.baseAsset,
      quoteAsset: primaryStrategy.quoteAsset,
      contractType: primaryStrategy.contractType
    },
    strategies: runtimeStrategies,
    strategyRuntimes: orchestrator.runtimes,
    accountGuard,
    marginGuard: primaryMargin.mode === 'cash' ? undefined : marketGuard
  };
};

const resolveStrategies = async (
  definitions: StrategyDefinition[],
  marketRepository: MarketStructureRepository,
  logger: ReturnType<typeof createLogger>,
  risk: ReturnType<typeof loadConfig>['risk'],
  resolveFees: (exchangeCode: string | null, symbol: string, productType: string) => Promise<{
    makerBps: number;
    takerBps: number;
    source?: string;
  }>
): Promise<RuntimeStrategyConfig[]> => {
  const resolved = await Promise.all(
    definitions.map(async (definition) => {
      let resolvedSymbol = definition.tradeSymbol.toUpperCase();
      const exchangeCode = feedTypeToExchange(definition.primaryFeed);
      let baseAsset: string | undefined;
      let quoteAsset: string | undefined;
      let contractType: string | undefined;
      let tickSize: number | undefined;
      let lotSize: number | undefined;

      if (exchangeCode) {
        const marketPair = await marketRepository.getExchangePair(exchangeCode, definition.tradeSymbol);
        if (!marketPair) {
          logger.warn(
            { exchange: exchangeCode, symbol: definition.tradeSymbol },
            'Market structure missing; using configured symbol as-is'
          );
        } else {
          resolvedSymbol = marketPair.exchangePair.exchSymbol.toUpperCase();
          contractType = marketPair.exchangePair.contractType;
          tickSize = marketPair.exchangePair.tickSize ?? undefined;
          lotSize = marketPair.exchangePair.lotSize ?? undefined;
        }
      }

      if (!baseAsset || !quoteAsset) {
        const inferred = inferBaseQuote(definition.tradeSymbol);
        if (inferred) {
          baseAsset = baseAsset ?? inferred.base;
          quoteAsset = quoteAsset ?? inferred.quote;
        }
      }

      ensurePriceBand(risk, definition.tradeSymbol, resolvedSymbol);

      const fees = await resolveFees(exchangeCode, resolvedSymbol, contractType ?? 'SPOT');

      return {
        definition: { ...definition, tradeSymbol: resolvedSymbol },
        venue: exchangeCode ?? 'paper',
        baseAsset,
        quoteAsset,
        contractType,
        tickSize,
        lotSize,
        fees
      } satisfies RuntimeStrategyConfig;
    })
  );

  return resolved;
};

const selectPrimaryStrategy = (strategies: RuntimeStrategyConfig[]): RuntimeStrategyConfig => {
  return strategies.find((strategy) => strategy.definition.mode === 'live') ?? strategies[0]!;
};

const ensurePriceBand = (
  risk: ReturnType<typeof loadConfig>['risk'],
  originalSymbol: string,
  resolvedSymbol: string
) => {
  const upperOriginal = originalSymbol.toUpperCase();
  const upperResolved = resolvedSymbol.toUpperCase();
  if (!risk.priceBands[upperResolved] && risk.priceBands[upperOriginal]) {
    risk.priceBands[upperResolved] = risk.priceBands[upperOriginal];
  }
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
