import { monitorPostTradeRisk } from '@rx-trader/risk/postTrade';
import { portfolio$, portfolioAnalytics$ } from '@rx-trader/portfolio';
import type { Fill, PortfolioAnalytics } from '@rx-trader/core/domain';
import { startApiServer } from './apiServer';
import { buildRuntime } from './runtimeBuilder';
import { createIntentReconciler, ExecutionCircuitOpenError } from '@rx-trader/pipeline';
import { auditTime } from 'rxjs';
import {
  BalanceSyncService,
  BinanceBalanceProvider,
  HyperliquidBalanceProvider,
  MockBalanceProvider,
  type BalanceProvider
} from '@rx-trader/portfolio';

import type { RuntimeDependencies } from './runtimeBuilder';
import type { EnvOverrides, AppConfig } from '@rx-trader/config';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';
import { wireFillAccounting } from '@rx-trader/portfolio';
import type { InstrumentMetadata, FeedManagerResult } from '@rx-trader/pipeline';
import { RebalanceService, TransferExecutionService, createTransferProviders } from '@rx-trader/portfolio';

export interface EngineDependencies extends RuntimeDependencies {
  startApiServer?: typeof startApiServer;
  createBalanceProvider?: (input: BalanceProviderFactoryInput) => BalanceProvider;
}

export interface StartEngineOptions {
  live?: boolean;
  registerSignalHandlers?: boolean;
  configOverrides?: EnvOverrides;
  clock?: Clock;
  dependencies?: EngineDependencies;
}

export interface EngineHandle {
  stop: () => void;
}

export const startEngine = async (options: StartEngineOptions = {}): Promise<EngineHandle> => {
  const live = options.live ?? false;
  const registerSignals = options.registerSignalHandlers ?? true;
  const clock: Clock = options.clock ?? systemClock;

  const {
    config,
    store,
    metrics,
    feedManager,
    persistence,
    execution,
    riskStreams: { approved$, rejected$ },
    marketStore,
    logger,
    accountState,
    instrument
  } = await buildRuntime({ ...options, clock }, options.dependencies);

  rejected$.subscribe((decision) => {
    metrics.riskRejected.inc();
    logger.warn({ reasons: decision.reasons }, 'Order rejected');
  });

  const fills$ = execution.fills$;
  fills$.subscribe((fill: Fill) => logger.info({ fill }, 'Fill event'));

  const stopAccounting = wireFillAccounting({
    fills$,
    baseAsset: instrument.baseAsset,
    quoteAsset: instrument.quoteAsset,
    venue: instrument.venue ?? execution.adapter.id,
    accountId: config.execution.account,
    clock,
    enqueue: persistence.enqueue
  });

  const balanceProviderFactory = options.dependencies?.createBalanceProvider ?? createBalanceProvider;
  const balanceProvider = balanceProviderFactory({
    instrument,
    config,
    feedManager,
    live
  });
  const balanceSync = new BalanceSyncService({
    accountId: config.execution.account,
    provider: balanceProvider,
    getBalance: (venue, asset) => accountState.getBalance(venue, asset),
    enqueue: persistence.enqueue,
    clock,
    intervalMs: config.accounting?.balanceSyncIntervalMs,
    driftBpsThreshold: config.accounting?.balanceSyncMaxDriftBps,
    logger,
    instrumentation: {
      recordSuccess: ({ venue, timestampMs, driftBps }) => {
        metrics.balanceSyncStatus.set({ venue }, 1);
        metrics.balanceSyncLastSuccess.set({ venue }, timestampMs / 1000);
        metrics.balanceSyncDriftBps.set({ venue }, driftBps ?? 0);
      },
      recordFailure: ({ venue }) => {
        metrics.balanceSyncStatus.set({ venue }, 0);
        metrics.balanceSyncFailures.inc({ venue });
      }
    }
  });
  await balanceSync.start();
  const balanceTelemetry = () => balanceSync.getTelemetry();

  const rebalancer = new RebalanceService({
    store,
    targets: config.rebalancer.targets,
    intervalMs: config.rebalancer.intervalMs,
    logger,
    metrics,
    accountId: config.execution.account,
    enqueue: persistence.enqueue
  });
  await rebalancer.start();

  const transferExecutor = new TransferExecutionService({
    enabled: config.rebalancer.executor.auto,
    store,
    enqueue: persistence.enqueue,
    providers: createTransferProviders({
      mode: config.rebalancer.executor.mode,
      live,
      logger
    }),
    logger,
    metrics,
    clock
  });
  transferExecutor.start();

  const intentReconciler = createIntentReconciler({
    config: config.execution.reliability.reconciliation,
    clock,
    logger,
    metrics,
    adapter: execution.adapter,
    ack$: execution.acks$,
    fills$: execution.fills$,
    rejects$: execution.rejects$
  });

  approved$.subscribe(async (decision) => {
    persistence.enqueue({
      id: crypto.randomUUID(),
      type: 'order.new',
      data: decision.order,
      ts: clock.now()
    });
    const release = intentReconciler.track(decision.order);
    try {
      await execution.submit(decision.order);
      if (!live || !config.venues?.binance) {
        logger.info({ order: decision.order }, 'Dry-run paper execution');
      }
      metrics.ordersSubmitted.inc();
    } catch (error) {
      release();
      if (error instanceof ExecutionCircuitOpenError) {
        const reason = `circuit-open:${execution.adapter.id}`;
        logger.error({ orderId: decision.order.id, reason }, 'Execution blocked by circuit');
        persistence.enqueue({
          id: crypto.randomUUID(),
          type: 'order.reject',
          data: {
            id: decision.order.id,
            t: clock.now(),
            reason
          },
          ts: clock.now()
        });
      } else {
        logger.error({ error: error instanceof Error ? error.message : error }, 'Execution submit error');
      }
    }
  });

  const snapshots$ = portfolio$({ fills$, marks$: feedManager.marks$ }, clock);
  const analytics$ = portfolioAnalytics$(snapshots$);

  monitorPostTradeRisk(snapshots$, { navFloor: -10_000, maxDrawdown: 5_000 }).subscribe(
    (decision) => {
      logger.error({ action: decision.action, reason: decision.reason }, 'Risk breach');
    }
  );

  const persistThrottleMs = Number(process.env.PERSIST_THROTTLE_MS ?? '250');

  snapshots$.pipe(auditTime(persistThrottleMs)).subscribe((snapshot) => {
    persistence.enqueue({
      id: crypto.randomUUID(),
      type: 'portfolio.snapshot',
      data: snapshot,
      ts: snapshot.t
    });
  });

  analytics$.pipe(auditTime(persistThrottleMs)).subscribe((analytics: PortfolioAnalytics) => {
    metrics.portfolioNav.set(analytics.nav);
    persistence.enqueue({
      id: crypto.randomUUID(),
      type: 'pnl.analytics',
      data: analytics,
      ts: analytics.t
    });
  });

  const startApi = options.dependencies?.startApiServer ?? startApiServer;
  const stopApi = await startApi({
    config,
    store,
    logger,
    metrics,
    live,
    accounting: { balanceTelemetry },
    rebalancer: () => rebalancer.getTelemetry()
  });

  let stopped = false;
  const handleShutdown = () => {
    if (stopped) return;
    stopped = true;
    persistence.shutdown();
    marketStore.close();
    stopAccounting();
    balanceSync.stop();
    rebalancer.stop();
    transferExecutor.stop();
    accountState.stop();
    intentReconciler.stop();
    if (stopApi) {
      void stopApi();
    }
  };

  if (registerSignals) {
    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
  }

  logger.info({ live, gatewayPort: config.gateway.port }, 'Trader running');

  return {
    stop: handleShutdown
  };
};

interface BalanceProviderFactoryInput {
  instrument: InstrumentMetadata;
  config: AppConfig;
  feedManager: FeedManagerResult;
  live: boolean;
}

const createBalanceProvider = (
  input: BalanceProviderFactoryInput
): BalanceProvider => {
  const venueId = normalizeVenue(input.instrument.venue ?? input.instrument.symbol);
  if (venueId === 'binance' && input.config.venues?.binance && input.live) {
    return new BinanceBalanceProvider(input.config.venues.binance);
  }
  const hyperConfig = input.config.venues?.hyperliquid;
  if (venueId === 'hyperliquid' && hyperConfig?.walletAddress && input.live) {
    return new HyperliquidBalanceProvider({
      walletAddress: hyperConfig.walletAddress,
      subaccount: hyperConfig.subaccount ?? 0,
      baseUrl: hyperConfig.baseUrl
    });
  }

  const assets = inferAssetsFromSymbol(
    input.instrument.symbol,
    input.instrument.baseAsset,
    input.instrument.quoteAsset
  );

  return new MockBalanceProvider({
    venue: venueId,
    baseAsset: assets.base,
    quoteAsset: assets.quote,
    marks$: input.feedManager.marks$,
    fallbackPrice: 100
  });
};

const normalizeVenue = (value: string) => {
  const lower = (value ?? '').toLowerCase();
  if (lower.includes('binance')) return 'binance';
  if (lower.includes('hyperliquid')) return 'hyperliquid';
  if (lower.includes('paper')) return 'paper';
  return value ?? 'paper';
};

const inferAssetsFromSymbol = (
  symbol: string,
  base?: string,
  quote?: string
): { base: string; quote: string } => {
  if (base && quote) {
    return { base, quote };
  }
  const upper = symbol.toUpperCase();
  const candidates = ['USDT', 'USD', 'USDC', 'BTC', 'ETH', 'BNB', 'EUR', 'JPY'];
  for (const candidate of candidates) {
    if (upper.endsWith(candidate) && upper.length > candidate.length) {
      return {
        base: base ?? upper.slice(0, -candidate.length),
        quote: quote ?? candidate
      };
    }
  }
  return {
    base: base ?? upper,
    quote: quote ?? 'USD'
  };
};
