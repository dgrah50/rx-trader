import { loadConfig, type AppConfig } from '@rx-trader/config';
import { createLogger, createMetrics } from '@rx-trader/observability';
import { logStream$, type LogEntry } from '@rx-trader/observability/logStream';
import {
  positionsProjection,
  pnlProjection,
  balancesProjection,
  marginProjection,
  buildProjection,
  createEventStore
} from '@rx-trader/event-store';
import { orderNewSchema, type DomainEvent } from '@rx-trader/core/domain';
import { safeParse } from '@rx-trader/core/validation';
import type { Metrics } from '@rx-trader/observability/metrics';
import { ExecutionVenue } from '@rx-trader/core/constants';
import { getFeedHealthSnapshots, type FeedHealthSnapshot } from '@rx-trader/pipeline/feedHealth';
import type { BalanceSyncTelemetry } from '@rx-trader/portfolio/balances/types';
import { planRebalance, flattenBalancesState, type RebalancePlan } from '@rx-trader/portfolio';
import type { StrategyTelemetrySnapshot } from '@rx-trader/pipeline';
import { resolveStrategyMarginConfig } from './marginConfig';
import {
  PaperExecutionAdapter,
  BinanceMockGateway,
  HyperliquidMockGateway,
  BinanceRestGateway,
  HyperliquidRestGateway,
  type ExecutionAdapter,
  type BinanceRestGatewayConfig,
  type HyperliquidRestGatewayConfig
} from '@rx-trader/execution';
import { join, normalize, resolve } from 'node:path';

const createExecutionAdapters = (config: AppConfig) => {
  const binanceConfig: BinanceRestGatewayConfig | undefined = config.venues?.binance;
  const binanceAdapter: ExecutionAdapter = binanceConfig
    ? new BinanceRestGateway(binanceConfig)
    : new BinanceMockGateway();

  // Only construct the real Hyperliquid REST adapter when API creds are present.
  const hyperRaw = config.venues?.hyperliquid as
    | (HyperliquidRestGatewayConfig & { walletAddress?: string; subaccount?: number })
    | undefined;
  const hyperliquidAdapter: ExecutionAdapter =
    hyperRaw && typeof hyperRaw.apiKey === 'string' && typeof hyperRaw.apiSecret === 'string'
      ? new HyperliquidRestGateway(hyperRaw)
      : new HyperliquidMockGateway();

  const paperAdapter: ExecutionAdapter = new PaperExecutionAdapter(ExecutionVenue.Paper);

  return {
    [ExecutionVenue.Paper]: paperAdapter,
    [ExecutionVenue.Binance]: binanceAdapter,
    [ExecutionVenue.Hyperliquid]: hyperliquidAdapter
  };
};

export type ExecutionAdapters = ReturnType<typeof createExecutionAdapters>;

export type StrategyRuntimeStatus = StrategyTelemetrySnapshot;

type StrategyStatusSource = StrategyRuntimeStatus[] | (() => StrategyRuntimeStatus[]);

export interface RuntimeMeta {
  live?: boolean;
  strategies?: StrategyStatusSource;
}

interface AccountingTelemetry {
  balanceTelemetry?: () => BalanceSyncTelemetry | null | undefined;
  rebalancer?: () => unknown;
}

const clampHistoryLimit = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 10;
  return Math.max(1, Math.min(100, Math.floor(value)));
};

const emptyStrategyMetrics = (): StrategyRuntimeStatus['metrics'] => ({
  signals: 0,
  intents: 0,
  orders: 0,
  fills: 0,
  rejects: 0,
  lastSignalTs: null,
  lastIntentTs: null,
  lastOrderTs: null,
  lastFillTs: null,
  lastRejectTs: null
});

const emptyExitMetrics = (): StrategyRuntimeStatus['exits'] => ({
  total: 0,
  byReason: {},
  lastReason: null,
  lastTs: null
});

const normalizeStrategyStatus = (
  definition: AppConfig['strategies'][number],
  fees: { makerBps: number; takerBps: number; source: string },
  config: AppConfig
): StrategyRuntimeStatus => ({
  id: definition.id,
  type: definition.type,
  tradeSymbol: definition.tradeSymbol,
  primaryFeed: definition.primaryFeed,
  extraFeeds: definition.extraFeeds ?? [],
  mode: definition.mode ?? 'live',
  priority: definition.priority ?? 0,
  budget: definition.budget,
  params: definition.params ?? {},
  fees,
  margin: resolveStrategyMarginConfig(definition, config),
  metrics: emptyStrategyMetrics(),
  exits: emptyExitMetrics()
});

const readBacktestHistory = async (
  store: Awaited<ReturnType<typeof createEventStore>>,
  limit: number
) => {
  const events = await store.read();
  return events
    .filter((event) => event.type === 'backtest.artifact')
    .sort((a, b) => b.ts - a.ts)
    .slice(0, clampHistoryLimit(limit))
    .map((event) => ({
      id: event.id,
      ts: event.ts,
      summary: (event.data as any)?.summary ?? null,
      stats: (event.data as any)?.stats ?? null
    }));
};

export interface GatewayOptions {
  store?: Awaited<ReturnType<typeof createEventStore>>;
  logger?: ReturnType<typeof createLogger>;
  metrics?: ReturnType<typeof createMetrics>;
  runtimeMeta?: RuntimeMeta;
  accounting?: AccountingTelemetry;
}

const readRecentOrders = async (
  store: Awaited<ReturnType<typeof createEventStore>>,
  limit: number
) => {
  const events = await store.read();
  return events
    .filter((event) => event.type.startsWith('order.'))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, clampHistoryLimit(limit))
    .map((event) => ({ id: event.id, type: event.type, ts: event.ts, data: event.data }));
};

const readRecentEvents = async (
  store: Awaited<ReturnType<typeof createEventStore>>,
  limit: number
) => {
  const events = await store.read();
  return events
    .sort((a, b) => b.ts - a.ts)
    .slice(0, clampHistoryLimit(limit));
};

const getClientKey = (request: Request) =>
  request.headers.get('x-forwarded-for') ?? request.headers.get('cf-connecting-ip') ?? 'local';

export const createControlPlaneRouter = async (
  config: AppConfig = loadConfig(),
  options: GatewayOptions = {}
) => {
  const logger = options.logger ?? createLogger('gateway');
  const metrics: Metrics = options.metrics ?? createMetrics();
  const store = options.store ?? (await createEventStore(config, metrics));
  const runtimeMeta = options.runtimeMeta ?? {};
  const accounting = options.accounting ?? {};
  const balanceTelemetryFn = accounting.balanceTelemetry ?? (() => null);
  const rebalancerTelemetryFn = accounting.rebalancer ?? (() => null);
  let killSwitch = false;
  const authToken = config.controlPlane?.authToken ?? null;
  const rateLimitWindow = config.controlPlane?.rateLimit?.windowMs ?? 1000;
  const rateLimitMax = config.controlPlane?.rateLimit?.max ?? 50;
  const rateBuckets = new Map<string, { count: number; reset: number }>();
  const dashboardRoot = config.controlPlane?.dashboard?.distDir
    ? resolve(config.controlPlane.dashboard.distDir)
    : null;

  const executionAdapters = createExecutionAdapters(config);
  let lastBacktestArtifact: unknown = null;
  let lastEventTs: number | null = null;
  let lastLogTs: number | null = null;

  Object.values(executionAdapters).forEach((adapter) => {
    adapter.events$.subscribe(async (event) => {
      await store.append(event);
    });
  });

  const subscribers = new Set<(event: DomainEvent) => void>();
  const logSubscribers = new Set<(entry: LogEntry) => void>();
  const publishEvent = (event: DomainEvent) => {
    lastEventTs = event.ts ?? Date.now();
    subscribers.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        logger.error({ err: error }, 'Failed to send event to SSE subscriber');
      }
    });
  };
  const publishLog = (entry: LogEntry) => {
    lastLogTs = entry.t ?? Date.now();
    logSubscribers.forEach((listener) => {
      try {
        listener(entry);
      } catch (error) {
        logger.error({ err: error }, 'Failed to send log to SSE subscriber');
      }
    });
  };

  store.stream$.subscribe((event) => {
    publishEvent(event);
  });
  logStream$.subscribe((entry) => publishLog(entry));

const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers ?? {});
  headers.set('content-type', 'application/json');
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type,authorization');
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers
  });
};

const withCors = (response: Response) => {
  response.headers.set('access-control-allow-origin', '*');
  response.headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.headers.set('access-control-allow-headers', 'content-type,authorization');
  return response;
};

const handleCorsPreflight = (request: Request) => {
  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }));
  }
  return null;
};

  const enforceAuth = (request: Request) => {
    if (!authToken) return null;
    const header = request.headers.get('authorization') ?? '';
    if (header === `Bearer ${authToken}`) {
      return null;
    }
    return json({ error: 'unauthorized' }, { status: 401 });
  };

  const enforceRateLimit = (request: Request) => {
    if (!rateLimitMax || rateLimitMax <= 0) return null;
    const key = getClientKey(request);
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.reset < now) {
      bucket = { count: 0, reset: now + rateLimitWindow };
      rateBuckets.set(key, bucket);
    }
    if (bucket.count >= rateLimitMax) {
      const retryAfter = Math.max(0, Math.ceil((bucket.reset - now) / 1000));
      return json(
        { error: 'rate limit exceeded' },
        { status: 429, headers: { 'retry-after': String(retryAfter) } }
      );
    }
    bucket.count += 1;
    return null;
  };

  const sanitizePath = (pathname: string) => {
    const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    return normalized.startsWith('/') ? normalized.slice(1) : normalized;
  };

  const serveDashboardAsset = async (url: URL) => {
    if (!dashboardRoot) return null;
    if (url.pathname.startsWith('/api')) return null;
    const targetPath = (() => {
      if (url.pathname === '/' || url.pathname === '/dashboard') {
        return 'index.html';
      }
      if (url.pathname.startsWith('/dashboard/')) {
        const subPath = url.pathname.replace('/dashboard/', '');
        return subPath ? sanitizePath(subPath) : 'index.html';
      }
      return sanitizePath(url.pathname);
    })();
    const filePath = join(dashboardRoot, targetPath);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return withCors(new Response(file, { headers: { 'content-type': file.type || 'text/plain' } }));
    }
    if (targetPath !== 'index.html') {
      const fallback = Bun.file(join(dashboardRoot, 'index.html'));
      if (await fallback.exists()) {
          return withCors(new Response(fallback, { headers: { 'content-type': fallback.type || 'text/html' } }));
      }
    }
    return null;
  };

  const handlePositions = async () => {
    const state = await buildProjection(store, positionsProjection);
    return json(state.positions);
  };

  const readPnlSnapshot = async () => {
    const state = await buildProjection(store, pnlProjection);
    return state.latest ?? null;
  };

  const handlePnl = async () => {
    const snapshot = await readPnlSnapshot();
    return json(snapshot);
  };

  const handleAccountBalances = async () => {
    const state = await buildProjection(store, balancesProjection);
    return json({
      balances: state.balances,
      updated: state.updatedAt ?? null
    });
  };

  const handleAccountMargin = async () => {
    const state = await buildProjection(store, marginProjection);
    return json({
      summaries: state.summaries,
      updated: state.updatedAt ?? null
    });
  };

  const handleAccountSummary = async () => {
    const [balancesState, marginState, pnlSnapshot] = await Promise.all([
      buildProjection(store, balancesProjection),
      buildProjection(store, marginProjection),
      readPnlSnapshot()
    ]);
    return json({
      timestamp: Date.now(),
      nav: pnlSnapshot?.nav ?? null,
      realized: pnlSnapshot?.realized ?? null,
      unrealized: pnlSnapshot?.unrealized ?? null,
      balances: balancesState.balances,
      margin: marginState.summaries,
      updated: {
        balances: balancesState.updatedAt ?? null,
        margin: marginState.updatedAt ?? null,
        pnl: (pnlSnapshot as any)?.t ?? null
      }
    });
  };

  const handleRebalancePlan = async () => {
    if (!config.rebalancer?.targets?.length) {
      return json({ transfers: [], deficits: [], surpluses: [] });
    }
    const balancesState = await buildProjection(store, balancesProjection);
    const snapshots = flattenBalancesState(balancesState.balances ?? {});
    const plan: RebalancePlan = planRebalance(snapshots, config.rebalancer.targets);
    return json(plan);
  };

  const buildStatusPayload = async () => {
    const pnlSnapshot = await readPnlSnapshot();
    const balanceSync = balanceTelemetryFn();
    const feeds: FeedHealthSnapshot[] = getFeedHealthSnapshots();
    const defaultFeeTier = {
      makerBps: config.execution.policy.makerFeeBps,
      takerBps: config.execution.policy.takerFeeBps,
      source: 'config'
    };
    const strategySource: StrategyStatusSource =
      runtimeMeta.strategies ??
      (config.strategies ?? []).map((definition) =>
        normalizeStrategyStatus(definition, defaultFeeTier, config)
      );
    const strategyStatuses =
      typeof strategySource === 'function' ? strategySource() : strategySource;
    const primaryStrategySource = strategyStatuses[0] ?? null;
    const primaryStrategy = primaryStrategySource
      ? {
          type: primaryStrategySource.type,
          tradeSymbol: primaryStrategySource.tradeSymbol,
          primaryFeed: primaryStrategySource.primaryFeed,
          extraFeeds: primaryStrategySource.extraFeeds,
          params: primaryStrategySource.params ?? {},
          fees: primaryStrategySource.fees,
          margin: primaryStrategySource.margin
        }
      : null;

    return {
      timestamp: Date.now(),
      app: config.app,
      gateway: { port: config.gateway.port },
      runtime: {
        live: Boolean(runtimeMeta.live),
        killSwitch,
        strategy: primaryStrategy,
        strategies: strategyStatuses
      },
      persistence: {
        driver: config.persistence.driver,
        sqlitePath:
          config.persistence.driver === 'sqlite' ? config.persistence.sqlitePath : undefined
      },
      feeds,
      metrics: {
        nav: pnlSnapshot?.nav ?? null,
        realized: pnlSnapshot?.realized ?? null,
        unrealized: pnlSnapshot?.unrealized ?? null,
        eventSubscribers: subscribers.size,
        logSubscribers: logSubscribers.size,
        lastEventTs,
        lastLogTs
      },
      accounting: {
        balanceSync,
        rebalancer: rebalancerTelemetryFn()
      }
    };
  };

  const appendNewOrder = async (payload: unknown) => {
    const order = safeParse(orderNewSchema, payload);
    await store.append({
      id: crypto.randomUUID(),
      type: 'order.new',
      data: order,
      ts: Date.now()
    });
    metrics.ordersSubmitted.inc();
    return order;
  };

  const handleOrders = async (request: Request) => {
    if (killSwitch) {
      return json({ error: 'kill switch engaged' }, { status: 403 });
    }
    await appendNewOrder(await request.json());
    return json({ ok: true });
  };

  const handleVenueOrder = async (venue: ExecutionVenue, request: Request) => {
    if (killSwitch) {
      return json({ error: 'kill switch engaged' }, { status: 403 });
    }
    const adapter = executionAdapters[venue];
    if (!adapter) {
      return json({ error: `Unknown venue ${venue}` }, { status: 404 });
    }
    const order = await appendNewOrder(await request.json());
    await adapter.submit(order);
    return json({ ok: true, venue });
  };

  const handleKill = async (request: Request) => {
    const body = (await request.json()) as { scope?: string };
    killSwitch = true;
    logger.warn({ scope: body.scope ?? 'all' }, 'Kill switch engaged');
    return json({ ok: true, scope: body.scope ?? 'all' });
  };

  const handleMetrics = async () => {
    return withCors(
      new Response(await metrics.register.metrics(), {
        headers: { 'content-type': metrics.register.contentType }
      })
    );
  };

  const encoder = new TextEncoder();
  const sseHeaders = {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  };

  const handleEventStream = () => {
    let listener: ((event: DomainEvent) => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        listener = (event: DomainEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        heartbeat = setInterval(() => {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }, 15_000);
        subscribers.add(listener);
        controller.enqueue(encoder.encode('event: ready\ndata: {}\n\n'));
      },
      cancel() {
        if (listener) {
          subscribers.delete(listener);
        }
        if (heartbeat) {
          clearInterval(heartbeat);
        }
      }
    });
    return withCors(new Response(stream, { headers: sseHeaders }));
  };

  const handleLogStream = () => {
    let listener: ((entry: LogEntry) => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        listener = (entry: LogEntry) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
        };
        heartbeat = setInterval(() => {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }, 15_000);
        logSubscribers.add(listener);
        controller.enqueue(encoder.encode('event: ready\ndata: {}\n\n'));
      },
      cancel() {
        if (listener) {
          logSubscribers.delete(listener);
        }
        if (heartbeat) {
          clearInterval(heartbeat);
        }
      }
    });
    return withCors(new Response(stream, { headers: sseHeaders }));
  };

  return async (request: Request) => {
    const url = new URL(request.url);
    const corsResponse = handleCorsPreflight(request);
    if (corsResponse) return corsResponse;
    if (url.pathname === '/health') {
      return json({ ok: true, env: config.app.env });
    }
    const authError = enforceAuth(request);
    if (authError) return authError;
    const rateError = enforceRateLimit(request);
    if (rateError) return rateError;
    if (url.pathname === '/positions' && request.method === 'GET') {
      return handlePositions();
    }
    if (url.pathname === '/pnl' && request.method === 'GET') {
      return handlePnl();
    }
    if (url.pathname === '/account/balances' && request.method === 'GET') {
      return handleAccountBalances();
    }
    if (url.pathname === '/account/margin' && request.method === 'GET') {
      return handleAccountMargin();
    }
    if (url.pathname === '/account/summary' && request.method === 'GET') {
      return handleAccountSummary();
    }
    if (url.pathname === '/account/sync' && request.method === 'GET') {
      return json(balanceTelemetryFn());
    }
    if (url.pathname === '/account/rebalance/plan' && request.method === 'GET') {
      return handleRebalancePlan();
    }
    if (url.pathname === '/status' && request.method === 'GET') {
      return json(await buildStatusPayload());
    }
    if (url.pathname === '/feeds/health' && request.method === 'GET') {
      return json(getFeedHealthSnapshots());
    }
    if (url.pathname === '/backtest/artifacts' && request.method === 'GET') {
      return json(lastBacktestArtifact ?? null);
    }
    if (url.pathname === '/backtest/artifacts' && request.method === 'POST') {
      const body = await request.json();
      lastBacktestArtifact = body;
      await store.append({
        id: crypto.randomUUID(),
        type: 'backtest.artifact',
        data: body,
        ts: Date.now()
      });
      return json({ ok: true });
    }
    if (url.pathname === '/backtest/artifacts/history' && request.method === 'GET') {
      const limit = clampHistoryLimit(Number(url.searchParams.get('limit') ?? '10'));
      const history = await readBacktestHistory(store, limit);
      return json(history);
    }
    if (url.pathname === '/orders/recent' && request.method === 'GET') {
      const limit = clampHistoryLimit(Number(url.searchParams.get('limit') ?? '20'));
      const recent = await readRecentOrders(store, limit);
      return json(recent);
    }
    if (url.pathname === '/orders' && request.method === 'POST') {
      return handleOrders(request);
    }
    if (url.pathname === '/orders/binance' && request.method === 'POST') {
      return handleVenueOrder(ExecutionVenue.Binance, request);
    }
    if (url.pathname === '/orders/hyperliquid' && request.method === 'POST') {
      return handleVenueOrder(ExecutionVenue.Hyperliquid, request);
    }
    if (url.pathname === '/kill' && request.method === 'POST') {
      return handleKill(request);
    }
    if (url.pathname === '/metrics') {
      return handleMetrics();
    }
    if (url.pathname === '/events' && request.method === 'GET') {
      return handleEventStream();
    }
    if (url.pathname === '/events/recent' && request.method === 'GET') {
      const limit = clampHistoryLimit(Number(url.searchParams.get('limit') ?? '20'));
      const recentEvents = await readRecentEvents(store, limit);
      return json(recentEvents);
    }
    if (url.pathname === '/logs' && request.method === 'GET') {
      return handleLogStream();
    }
    if (request.method === 'GET') {
      const staticResponse = await serveDashboardAsset(url);
      if (staticResponse) {
        return staticResponse;
      }
    }
    return withCors(new Response('Not Found', { status: 404 }));
  };
};
