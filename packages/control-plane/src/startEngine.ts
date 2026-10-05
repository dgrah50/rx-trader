import { EVENT_TYPE } from '@rx-trader/core';
import { deterministicUuid, hashCanonical } from '@rx-trader/core/integrity';
import { monitorPostTradeRisk } from '@rx-trader/risk/postTrade';
import { portfolio$, portfolioAnalytics$ } from '@rx-trader/portfolio';
import type {
  Fill,
  PortfolioAnalytics,
  PortfolioSnapshot,
  BalanceEntry,
  DomainEvent,
  OrderNew,
} from '@rx-trader/core/domain';
import { accountBalanceAdjustedSchema } from '@rx-trader/core/domain';
import { startApiServer } from './apiServer';
import { buildRuntime } from './runtimeBuilder';
import type { BalanceProviderFactoryInput, StartEngineOptions } from './runtimeTypes';
import {
  createIntentReconciler,
  ExecutionCircuitOpenError,
  createStrategyTelemetry,
  createExitEngine,
  type ExitEngineHandle,
} from '@rx-trader/pipeline';
import { auditTime, filter, map, distinctUntilChanged } from 'rxjs';
import type { Observable, Subscription } from 'rxjs';
import {
  BalanceSyncService,
  BinanceBalanceProvider,
  HyperliquidBalanceProvider,
  MockBalanceProvider,
  type BalanceProvider,
} from '@rx-trader/portfolio';
import type { AppConfig } from '@rx-trader/config';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';
import { wireFillAccounting } from '@rx-trader/portfolio';
import { safeParse } from '@rx-trader/core/validation';
import {
  normalizeExecutionVenue as normalizeVenue,
  splitSymbolAssets,
} from '@rx-trader/core/instruments';
import type { InstrumentMetadata } from '@rx-trader/pipeline';
import {
  RebalanceService,
  TransferExecutionService,
  createTransferProviders,
} from '@rx-trader/portfolio';
import type { EventStore } from '@rx-trader/event-store';
import { createAuditLogger } from './auditLogger';
import { toPricePoints } from '@rx-trader/strategies/utils';
export type { EngineDependencies, StartEngineOptions } from './runtimeTypes';

type AccountBalanceAdjusted = ReturnType<(typeof accountBalanceAdjustedSchema)['parse']>;

export interface EngineHandle {
  stop: () => Promise<void>;
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
    instrument,
    strategyRuntimes,
    accountGuard,
    marginGuard,
    exitIntentSink,
    eventBus,
    reconcile$,
  } = await buildRuntime({ ...options, clock }, options.dependencies);

  const { RingBuffer } = await import('@rx-trader/core');
  const ringBuffer = new RingBuffer<DomainEvent>(1000);

  eventBus.onAll().subscribe((event) => {
    ringBuffer.push(event);
  });

  const PERSISTED_EVENTS = new Set<string>([
    EVENT_TYPE.ORDER_NEW,
    EVENT_TYPE.ORDER_FILL,
    EVENT_TYPE.ORDER_REJECT,
    EVENT_TYPE.ORDER_CANCEL,
    EVENT_TYPE.ORDER_ACK,
    EVENT_TYPE.PORTFOLIO_SNAPSHOT,
    EVENT_TYPE.PNL_ANALYTICS,
    EVENT_TYPE.ACCOUNT_BALANCE_ADJUSTED,
    EVENT_TYPE.ACCOUNT_BALANCE_SNAPSHOT,
    EVENT_TYPE.ACCOUNT_TRANSFER,
    EVENT_TYPE.RISK_CHECK,
  ]);

  eventBus.onAll().subscribe((event) => {
    if (PERSISTED_EVENTS.has(event.type)) {
      persistence.enqueue(event);
    }
  });

  const auditEnabled = Boolean(
    process.env.AUDIT_LOG_PATH ||
      (process.env.AUDIT_VERBOSE ?? '').toLowerCase() === 'true' ||
      process.env.AUDIT_VERBOSE === '1',
  );
  const audit = createAuditLogger({
    enabled: auditEnabled,
    path: process.env.AUDIT_LOG_PATH,
    logger,
  });

  const exitHandles: ExitEngineHandle[] = [];
  const exitSubscriptions: Subscription[] = [];

  const venueId = instrument.venue ?? execution.adapter.id;
  const normalizedVenue = normalizeVenue(venueId);
  const quoteAsset = instrument.quoteAsset;

  type BalanceView = {
    available: number;
    locked: number;
    total: number;
    lastUpdated?: number;
  };

  type BalanceSnapshot = {
    base: BalanceView | null;
    quote: BalanceView | null;
  };

  const summarizeBalanceEntry = (entry?: BalanceEntry | null): BalanceView | null =>
    entry
      ? {
          available: entry.available,
          locked: entry.locked,
          total: entry.total,
          lastUpdated: entry.lastUpdated,
        }
      : null;

  const captureBalances = (): BalanceSnapshot | null => {
    const baseEntry = instrument.baseAsset
      ? accountState.getBalance(normalizedVenue, instrument.baseAsset)
      : undefined;
    const quoteEntry = quoteAsset
      ? accountState.getBalance(normalizedVenue, quoteAsset)
      : undefined;
    if (!baseEntry && !quoteEntry) {
      return null;
    }
    return {
      base: summarizeBalanceEntry(baseEntry ?? null),
      quote: summarizeBalanceEntry(quoteEntry ?? null),
    };
  };

  const getOrderPx = (order: OrderNew) => {
    if (typeof order.px === 'number' && Number.isFinite(order.px)) return order.px;
    const execPx = order.meta?.execRefPx;
    return typeof execPx === 'number' ? execPx : null;
  };

  const projectBalances = (snapshot: BalanceSnapshot | null, fill: Fill) => {
    if (!snapshot) return null;
    const px = fill.px ?? 0;
    const fee = fill.fee ?? 0;
    const baseStart = snapshot.base?.total ?? 0;
    const quoteStart = snapshot.quote?.total ?? 0;
    const baseDelta = fill.side === 'BUY' ? fill.qty : -fill.qty;
    const quoteDelta = fill.side === 'BUY' ? -(fill.qty * px) - fee : fill.qty * px - fee;
    return {
      baseAfter: baseStart + baseDelta,
      quoteAfter: quoteStart + quoteDelta,
      baseDelta,
      quoteDelta,
    };
  };

  const describeMarginState = () => marginGuard?.inspect?.() ?? null;
  const describeQuoteReserve = () => accountGuard?.inspect?.() ?? null;
  const logAudit = audit.log;

  const seedResult = await seedDemoBalanceIfNeeded({
    live,
    config,
    store,
    accountState,
    instrument,
    clock,
  });

  const initialCash = getInitialCashBalance({
    accountState,
    venue: normalizedVenue,
    quoteAsset,
    fallback: seedResult?.amount,
  });

  const cashAdjustments$ = createQuoteCashAdjustment$({
    store,
    venue: normalizedVenue,
    quoteAsset,
  });

  const fillLedger$ = createQuoteFillLedger$({
    store,
    venue: normalizedVenue,
    quoteAsset,
  });

  fillLedger$?.subscribe(({ orderId, amount }) => {
    accountGuard?.consume?.(orderId, amount);
    logAudit('quote-ledger', {
      orderId,
      ledgerAmount: amount,
      quoteReserve: describeQuoteReserve(),
    });
  });

  const strategyTelemetry = createStrategyTelemetry({
    strategies: strategyRuntimes,
    eventBus,
    clock,
  });

  rejected$.subscribe((decision) => {
    metrics.riskRejected.inc();
    logger.warn({ reasons: decision.reasons }, 'Order rejected');

    const orderDedupeKey = `order.new:${config.execution.account}:${decision.order.id}`;
    eventBus.emit({
      id: deterministicUuid(`event:${orderDedupeKey}`),
      dedupeKey: orderDedupeKey,
      type: 'order.reject',
      data: {
        id: decision.order.id,
        t: clock.now(),
        reason: decision.reasons?.join(', ') ?? 'risk-check-failed',
      },
      ts: clock.now(),
      metadata: {
        reasons: decision.reasons,
        risk: true,
      },
    });

    logAudit('risk-rejected', {
      orderId: decision.order.id,
      symbol: decision.order.symbol,
      side: decision.order.side,
      qty: decision.order.qty,
      px: getOrderPx(decision.order),
      reasons: decision.reasons,
      balances: captureBalances(),
      quoteReserve: describeQuoteReserve(),
      margin: describeMarginState(),
    });
  });

  const pendingOrders = new Map<string, OrderNew>();

  const fills$ = execution.fills$;
  fills$.subscribe((fill: Fill) => {
    pendingOrders.delete(fill.orderId);
    const balancesBefore = captureBalances();
    const projection = projectBalances(balancesBefore, fill);
    logAudit('fill', {
      fill,
      balancesBefore,
      projection,
      margin: describeMarginState(),
      quoteReserve: describeQuoteReserve(),
    });
    logger.info({ fill }, 'Fill event');

    if (fill.fee && fill.fee > 0) {
      accountGuard?.consume?.(fill.orderId, fill.fee);
      logAudit('quote-reserve', {
        orderId: fill.orderId,
        fee: fill.fee,
        quoteReserve: describeQuoteReserve(),
      });
    }

    if (fill.side === 'BUY') {
      accountGuard?.releaseBase?.(fill.orderId);
    }
  });

  execution.rejects$.subscribe((reject) => {
    const order = pendingOrders.get(reject.id);
    if (order) {
      pendingOrders.delete(reject.id);
      reconcile$?.next(order);
    }

    accountGuard?.release?.(reject.id);
    logAudit('execution-reject', {
      orderId: reject.id,
      reason: reject.reason,
      quoteReserve: describeQuoteReserve(),
      margin: describeMarginState(),
    });
  });

  const stopAccounting = wireFillAccounting({
    fills$,
    baseAsset: instrument.baseAsset,
    quoteAsset: instrument.quoteAsset,
    venue: instrument.venue ?? execution.adapter.id,
    accountId: config.execution.account,
    clock,
    enqueue: (event) => eventBus.emit(event),
  });

  const balanceProviderFactory =
    options.dependencies?.createBalanceProvider ?? createBalanceProvider;
  const balanceProvider = balanceProviderFactory({
    instrument,
    config,
    feedManager,
    live,
  });
  const driftThreshold =
    live && (config.accounting?.balanceSyncMaxDriftBps ?? null) !== null
      ? config.accounting?.balanceSyncMaxDriftBps
      : Number.POSITIVE_INFINITY;
  const balanceSync = new BalanceSyncService({
    accountId: config.execution.account,
    provider: balanceProvider,
    getBalance: (venue, asset) => accountState.getBalance(venue, asset),
    enqueue: (event) => eventBus.emit(event),
    enqueueSnapshot: (event) => eventBus.emit(event),
    clock,
    intervalMs: config.accounting?.balanceSyncIntervalMs,
    driftBpsThreshold: driftThreshold,
    applyLedgerDeltas: Boolean(config.accounting?.balanceSyncMutatesLedger),
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
      },
    },
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
    enqueue: (event) => eventBus.emit(event),
  });
  await rebalancer.start();

  const transferExecutor = new TransferExecutionService({
    enabled: config.rebalancer.executor.auto,
    store,
    enqueue: (event) => eventBus.emit(event),
    providers: createTransferProviders({
      mode: config.rebalancer.executor.mode,
      live,
      logger,
    }),
    logger,
    metrics,
    clock,
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
    rejects$: execution.rejects$,
  });

  approved$.subscribe(async (decision) => {
    pendingOrders.set(decision.order.id, decision.order);
    const px = getOrderPx(decision.order);
    const notional = decision.notional ?? (px ? Math.abs(decision.order.qty * px) : null);
    logAudit('risk-approved', {
      orderId: decision.order.id,
      symbol: decision.order.symbol,
      side: decision.order.side,
      qty: decision.order.qty,
      px,
      notional,
      balances: captureBalances(),
      quoteReserve: describeQuoteReserve(),
      margin: describeMarginState(),
    });
    if (accountGuard && decision.notional && decision.order.side === 'BUY') {
      accountGuard.reserve?.(decision.order.id, decision.notional);
      accountGuard?.reserveBase?.(decision.order.id, decision.order.qty);
      logAudit('quote-reserve', {
        orderId: decision.order.id,
        reserved: decision.notional,
        baseQty: decision.order.qty,
        quoteReserve: describeQuoteReserve(),
      });
    }

    eventBus.emit({
      id: crypto.randomUUID(),
      type: 'order.new',
      data: decision.order,
      ts: clock.now(),
    });

    logAudit('order-new', {
      orderId: decision.order.id,
      symbol: decision.order.symbol,
      side: decision.order.side,
      qty: decision.order.qty,
      px,
      notional,
      quoteReserve: describeQuoteReserve(),
      margin: describeMarginState(),
    });
    const release = intentReconciler.track(decision.order);
    try {
      await execution.submit(decision.order);
      if (!live || !config.venues?.binance) {
        logger.info({ order: decision.order }, 'Dry-run paper execution');
      }
      metrics.ordersSubmitted.inc();
      logAudit('order-submit', {
        orderId: decision.order.id,
        symbol: decision.order.symbol,
        side: decision.order.side,
        qty: decision.order.qty,
        px,
        status: 'submitted',
        quoteReserve: describeQuoteReserve(),
        margin: describeMarginState(),
      });
    } catch (error) {
      release();
      pendingOrders.delete(decision.order.id);
      reconcile$?.next(decision.order);

      if (error instanceof ExecutionCircuitOpenError) {
        const reason = `circuit-open:${execution.adapter.id}`;
        logger.error({ orderId: decision.order.id, reason }, 'Execution blocked by circuit');

        eventBus.emit({
          id: crypto.randomUUID(),
          type: 'order.reject',
          data: {
            id: decision.order.id,
            t: clock.now(),
            reason,
          },
          ts: clock.now(),
        });
      } else {
        logger.error(
          { error: error instanceof Error ? error.message : error },
          'Execution submit error',
        );
      }
      accountGuard?.release?.(decision.order.id);
      logAudit('order-submit-error', {
        orderId: decision.order.id,
        symbol: decision.order.symbol,
        side: decision.order.side,
        qty: decision.order.qty,
        px,
        error: error instanceof Error ? error.message : String(error),
        quoteReserve: describeQuoteReserve(),
        margin: describeMarginState(),
      });
    }
  });

  const snapshots$ = portfolio$(
    { fills$, marks$: feedManager.marks$, cashAdjustments$, initialCash },
    clock,
  );
  const analytics$ = portfolioAnalytics$(snapshots$);
  const hookSubscriptions: Subscription[] = [];
  if (options.hooks?.onSnapshot) {
    hookSubscriptions.push(
      snapshots$.subscribe((snapshot) => options.hooks?.onSnapshot?.(snapshot)),
    );
  }
  if (options.hooks?.onAnalytics) {
    hookSubscriptions.push(
      analytics$.subscribe((analytics) => options.hooks?.onAnalytics?.(analytics)),
    );
  }

  strategyRuntimes.forEach((runtime) => {
    const exitConfig = runtime.definition.exit;
    if (!exitConfig?.enabled) {
      return;
    }
    const symbol = runtime.definition.tradeSymbol;
    const positionsForSymbol$ = snapshots$.pipe(
      map((snapshot) => snapshot.positions[symbol] ?? null),
      distinctUntilChanged(positionsEqual),
    );
    const price$ = runtime.feedManager.marks$.pipe(toPricePoints(symbol));
    const exitHandle = createExitEngine({
      strategyId: runtime.definition.id,
      symbol,
      accountId: config.execution.account,
      exit: exitConfig,
      clock,
      positions$: positionsForSymbol$,
      price$,
      signals$: runtime.signals$,
      analytics$,
    });
    if ((process.env.DEBUG_E2E ?? '').toLowerCase() === 'true') {
      logger.info({ strategyId: runtime.definition.id }, 'Exit engine wired');
    }
    exitHandles.push(exitHandle);
    const sub = exitHandle.exitIntents$.subscribe((order) => {
      exitIntentSink.next(order);
      options.hooks?.onExitIntent?.(order);
      const reason =
        typeof order.meta?.reason === 'string' ? (order.meta.reason as string) : undefined;
      strategyTelemetry.recordExit(runtime.definition.id, reason);
      logAudit('exit-intent', {
        order,
        balances: captureBalances(),
        quoteReserve: describeQuoteReserve(),
        margin: describeMarginState(),
      });
    });
    exitSubscriptions.push(sub);
  });

  monitorPostTradeRisk(snapshots$, { navFloor: -10_000, maxDrawdown: 5_000 }).subscribe(
    (decision) => {
      logger.error({ action: decision.action, reason: decision.reason }, 'Risk breach');
    },
  );

  const persistThrottleMs = Number(process.env.PERSIST_THROTTLE_MS ?? '250');
  const persistedSnapshots$ = options.persistPortfolioUpdatesImmediately
    ? snapshots$
    : snapshots$.pipe(auditTime(persistThrottleMs));
  const persistedAnalytics$ = options.persistPortfolioUpdatesImmediately
    ? analytics$
    : analytics$.pipe(auditTime(persistThrottleMs));

  persistedSnapshots$.subscribe((snapshot) => {
    const dedupeKey = `portfolio.snapshot:${hashCanonical(snapshot)}`;
    eventBus.emit({
      id: deterministicUuid(`event:${dedupeKey}`),
      dedupeKey,
      type: 'portfolio.snapshot',
      data: snapshot,
      ts: snapshot.t,
    });
  });

  persistedAnalytics$.subscribe((analytics: PortfolioAnalytics) => {
    metrics.portfolioNav.set(analytics.nav);
    const dedupeKey = `pnl.analytics:${hashCanonical(analytics)}`;
    eventBus.emit({
      id: deterministicUuid(`event:${dedupeKey}`),
      dedupeKey,
      type: 'pnl.analytics',
      data: analytics,
      ts: analytics.t,
    });
  });

  const startApi = options.dependencies?.startApiServer ?? startApiServer;
  const stopApi = await startApi({
    config,
    store,
    logger,
    metrics,
    live,
    runtimeMeta: {
      live,
      strategies: () => strategyTelemetry.snapshot(),
      events: () => ringBuffer.getRecent(100),
    },
    accounting: { balanceTelemetry },
    rebalancer: () => rebalancer.getTelemetry(),
  });

  let shutdownPromise: Promise<void> | null = null;
  const handleShutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      exitSubscriptions.forEach((sub) => sub.unsubscribe());
      exitHandles.forEach((handle) => handle.stop());
      exitIntentSink.complete();
      try {
        feedManager.stop();
      } catch (error) {
        logger?.warn?.({ error }, 'Failed to stop feed manager');
      }
      stopAccounting();
      balanceSync.stop();
      rebalancer.stop();
      transferExecutor.stop();
      strategyTelemetry.stop();
      intentReconciler.stop();
      hookSubscriptions.forEach((sub) => sub.unsubscribe());
      await persistence.shutdown();
      accountState.stop();
      marketStore.close();
      audit.close();
      if (stopApi) await stopApi();
    })();
    return shutdownPromise;
  };

  if (registerSignals) {
    process.on('SIGINT', () => void handleShutdown());
    process.on('SIGTERM', () => void handleShutdown());
  }

  logger.info({ live, gatewayPort: config.gateway.port }, 'Trader running');

  return {
    stop: handleShutdown,
  };
};

const createBalanceProvider = (input: BalanceProviderFactoryInput): BalanceProvider => {
  const venueId = normalizeVenue(input.instrument.venue ?? input.instrument.symbol);
  if (venueId === 'binance' && input.config.venues?.binance && input.live) {
    return new BinanceBalanceProvider(input.config.venues.binance);
  }
  const hyperConfig = input.config.venues?.hyperliquid;
  if (venueId === 'hyperliquid' && hyperConfig?.walletAddress && input.live) {
    return new HyperliquidBalanceProvider({
      walletAddress: hyperConfig.walletAddress,
      subaccount: hyperConfig.subaccount ?? 0,
      baseUrl: hyperConfig.baseUrl,
    });
  }

  const assets = inferAssetsFromSymbol(
    input.instrument.symbol,
    input.instrument.baseAsset,
    input.instrument.quoteAsset,
  );

  return new MockBalanceProvider({
    venue: venueId,
    baseAsset: assets.base,
    quoteAsset: assets.quote,
    marks$: input.feedManager.marks$,
    fallbackPrice: 100,
  });
};

const positionsEqual = (
  a: PortfolioSnapshot['positions'][string] | null,
  b: PortfolioSnapshot['positions'][string] | null,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  const posEqual = Math.abs(a.pos - b.pos) < 1e-12;
  const avgPxEqual = Math.abs(a.avgPx - b.avgPx) < 1e-9;
  const notionalEqual =
    Math.abs((a.notional ?? a.px * a.pos) - (b.notional ?? b.px * b.pos)) < 1e-2;
  return posEqual && avgPxEqual && notionalEqual;
};

const isBalanceAdjustedEvent = (
  event: DomainEvent,
): event is DomainEvent<'account.balance.adjusted'> => event.type === 'account.balance.adjusted';

const createQuoteCashAdjustment$ = ({
  store,
  venue,
  quoteAsset,
}: {
  store: Pick<EventStore, 'stream$'>;
  venue?: string;
  quoteAsset?: string;
}): Observable<number> | undefined => {
  if (!venue || !quoteAsset) {
    return undefined;
  }
  const normalizedVenue = normalizeVenue(venue);
  return store.stream$.pipe(
    filter(isBalanceAdjustedEvent),
    map((event) => event.data as AccountBalanceAdjusted),
    filter((data) => normalizeVenue(data.venue) === normalizedVenue),
    filter((data) => data.asset === quoteAsset),
    filter((data) => data.reason !== 'fill'),
    map((data) => data.delta),
  );
};

const createQuoteFillLedger$ = ({
  store,
  venue,
  quoteAsset,
}: {
  store: Pick<EventStore, 'stream$'>;
  venue?: string;
  quoteAsset?: string;
}): Observable<{ orderId: string; amount: number }> | undefined => {
  if (!venue || !quoteAsset) {
    return undefined;
  }
  const normalizedVenue = normalizeVenue(venue);
  return store.stream$.pipe(
    filter(isBalanceAdjustedEvent),
    map((event) => event.data as AccountBalanceAdjusted),
    filter((data) => data.reason === 'fill'),
    filter((data) => normalizeVenue(data.venue) === normalizedVenue),
    filter((data) => data.asset === quoteAsset),
    map((data) => ({
      orderId: extractOrderId(data.metadata),
      amount: Math.abs(data.delta),
    })),
    filter((payload) => Boolean(payload.orderId) && payload.amount > 0),
    map((payload) => ({ orderId: payload.orderId!, amount: payload.amount })),
  );
};

const extractOrderId = (metadata: Record<string, unknown> | undefined): string | null => {
  const value = metadata?.orderId;
  return typeof value === 'string' ? value : null;
};

const getInitialCashBalance = ({
  accountState,
  venue,
  quoteAsset,
  fallback,
}: {
  accountState: { getBalance: (venue: string, asset: string) => BalanceEntry | undefined };
  venue: string;
  quoteAsset?: string;
  fallback?: number;
}): number => {
  if (!quoteAsset) {
    return fallback ?? 0;
  }
  const entry = accountState.getBalance(venue, quoteAsset);
  if (entry && Number.isFinite(entry.available)) {
    return entry.available;
  }
  return fallback ?? 0;
};

const seedDemoBalanceIfNeeded = async ({
  live,
  config,
  store,
  accountState,
  instrument,
  clock,
}: {
  live: boolean;
  config: AppConfig;
  store: EventStore;
  accountState: { getBalance: (venue: string, asset: string) => BalanceEntry | undefined };
  instrument: InstrumentMetadata;
  clock: Clock;
}): Promise<{ amount: number; venue: string; asset: string } | null> => {
  if (live) return null;
  const seedAmount = config.accounting?.seedDemoBalance ?? 0;
  if (seedAmount <= 0) return null;
  const venue = instrument.venue ?? instrument.symbol ?? 'paper';
  const quoteAsset = instrument.quoteAsset ?? 'USDT';
  const existing = accountState.getBalance(venue, quoteAsset);
  if (existing && existing.total > 0) {
    return { amount: existing.total, venue, asset: quoteAsset };
  }
  const seedKey = `account.seed:${config.execution.account}:${venue}:${quoteAsset}`;
  const event = {
    id: deterministicUuid(`event:${seedKey}`),
    dedupeKey: seedKey,
    type: 'account.balance.adjusted' as const,
    data: safeParse(accountBalanceAdjustedSchema, {
      id: deterministicUuid(`payload:${seedKey}`),
      t: clock.now(),
      accountId: config.execution.account,
      venue,
      asset: quoteAsset,
      delta: seedAmount,
      reason: 'deposit',
      metadata: {
        seed: 'demo',
      },
    }),
    ts: clock.now(),
  };
  await store.append(event);
  return { amount: seedAmount, venue, asset: quoteAsset };
};

const inferAssetsFromSymbol = (
  symbol: string,
  base?: string,
  quote?: string,
): { base: string; quote: string } => {
  if (base && quote) {
    return { base, quote };
  }
  const inferred = splitSymbolAssets(symbol);
  return {
    base: base ?? inferred?.base ?? symbol.toUpperCase(),
    quote: quote ?? inferred?.quote ?? 'USD',
  };
};
