import { setTimeout as delay } from 'node:timers/promises';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { MarketTick, DomainEvent } from '@rx-trader/core/domain';
import { StrategyType, FeedType } from '@rx-trader/core/constants';
import { startEngine, type EngineDependencies } from '@rx-trader/control-plane';
import type { EnvOverrides } from '@rx-trader/config';
import {
  InMemoryEventStore,
  buildProjection,
  positionsProjection,
  pnlProjection
} from '@rx-trader/event-store';
import { BacktestScheduler } from './scheduler';
import { HistoricalFeedAdapter } from './historicalFeedAdapter';
import { createBacktestExecutionManager } from './execution';

type PositionsState = ReturnType<typeof positionsProjection.init>;
type PnlState = ReturnType<typeof pnlProjection.init>;

interface StrategyOverrides {
  type?: StrategyType;
  params?: Record<string, unknown>;
  primaryFeed?: FeedType;
}

interface RiskOverrides {
  notional?: number;
  maxPosition?: number;
}

interface ExecutionOverrides {
  mode?: 'market' | 'limit' | 'makerPreferred' | 'takerOnDrift';
  notionalUsd?: number;
  defaultQty?: number;
}

interface EngineBacktestOptions {
  ticks: MarketTick[];
  symbol: string;
  strategy?: StrategyOverrides;
  risk?: RiskOverrides;
  execution?: ExecutionOverrides;
}

interface BacktestClockMetadata {
  type: 'backtest-scheduler';
  startMs: number;
  endMs: number;
  spanMs: number;
  ticks: number;
}

interface EngineBacktestResult {
  events: DomainEvent[];
  positions: PositionsState;
  pnl: PnlState;
  navCurve: Array<{ t: number; nav: number }>;
  stats: BacktestStats;
  clock: BacktestClockMetadata;
}

interface BacktestStats {
  wallRuntimeMs: number;
  startupMs: number;
  replayMs: number;
  settleMs: number;
  teardownMs: number;
  ticksProcessed: number;
  tickSpanMs: number;
  ticksPerSecond: number;
  eventsPerSecond: number;
  eventCounts: EventCountStats;
  nav: NavStats;
}

interface EventCountStats {
  orderNew: number;
  orderAck: number;
  orderReject: number;
  orderFill: number;
  pnlAnalytics: number;
  portfolioSnapshots: number;
}

interface NavStats {
  startNav: number;
  endNav: number;
  change: number;
  changePct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpe: number;
  volatility: number;
  samples: number;
}

const buildEnvOverrides = (
  symbol: string,
  options: EngineBacktestOptions,
  sqlitePath: string
): EnvOverrides => {
  const strategyType = options.strategy?.type ?? StrategyType.Momentum;
  const primaryFeed = options.strategy?.primaryFeed ?? FeedType.Binance;
  const strategyParams = JSON.stringify(options.strategy?.params ?? {});
  const maxPosition = options.risk?.maxPosition ?? 10;
  const notional = options.risk?.notional ?? 1_000_000;
  const intentMode = options.execution?.mode ?? 'market';
  const notionalUsd = options.execution?.notionalUsd ?? 0;
  const defaultQty = options.execution?.defaultQty ?? 1;

  return {
    EVENT_STORE_DRIVER: 'memory',
    ACCOUNT_ID: 'BACKTEST',
    STRATEGY_TRADE_SYMBOL: symbol,
    STRATEGY_TYPE: strategyType,
    STRATEGY_PRIMARY_FEED: primaryFeed,
    STRATEGY_EXTRA_FEEDS: '',
    STRATEGY_PARAMS: strategyParams,
    RISK_MAX_POSITION: String(maxPosition),
    RISK_NOTIONAL_LIMIT: String(notional),
    RISK_PRICE_BAND_MIN: '0',
    RISK_PRICE_BAND_MAX: String(Number.MAX_SAFE_INTEGER),
    RISK_THROTTLE_WINDOW_MS: '0',
    RISK_THROTTLE_MAX_COUNT: '100',
    INTENT_MODE: intentMode,
    INTENT_DEFAULT_QTY: String(defaultQty),
    INTENT_NOTIONAL_USD: String(notionalUsd),
    INTENT_LIMIT_OFFSET_BPS: '0',
    INTENT_MIN_EDGE_BPS: '0',
    INTENT_TAKER_SLIP_BPS: '0',
    INTENT_ADVERSE_SELECTION_BPS: '0',
    INTENT_POST_ONLY: 'false',
    INTENT_REDUCE_ONLY: 'false',
    INTENT_COOLDOWN_MS: '0',
    INTENT_DEDUPE_WINDOW_MS: '0',
    INTENT_TIF: 'DAY',
    SQLITE_PATH: sqlitePath
  };
};

const createInlinePersistenceManager = (store: InMemoryEventStore) => {
  return {
    enqueue: (event: DomainEvent) => {
      void store.append(event);
    },
    shutdown: () => {}
  };
};

const createFeedManagerStub = (adapter: HistoricalFeedAdapter) => ({
  marks$: adapter.feed$,
  sources: [
    {
      id: adapter.id,
      stream: adapter.feed$,
      adapter
    }
  ]
});

export const runBacktest = async (options: EngineBacktestOptions): Promise<EngineBacktestResult> => {
  if (!options.ticks.length) {
    throw new Error('Backtest requires at least one tick');
  }

  const wallStart = performance.now();
  const sortedTicks = [...options.ticks].sort((a, b) => a.t - b.t);
  const symbol = options.symbol.toUpperCase();
  const scheduler = new BacktestScheduler(sortedTicks[0]!.t);
  const feedAdapter = new HistoricalFeedAdapter(`historical:${symbol}`);
  const feedManager = createFeedManagerStub(feedAdapter);
  const eventStore = new InMemoryEventStore();
  const persistence = createInlinePersistenceManager(eventStore);
  let latestTick: MarketTick | undefined;

const dependencies: EngineDependencies = {
  createFeedManager: () => feedManager,
  createExecutionManager: ({ enqueue }) =>
    createBacktestExecutionManager({
      clock: scheduler,
      enqueue,
      getLatestTick: () => latestTick
    }),
  createEventStore: async () => eventStore,
    createPersistenceManager: () => persistence,
    startApiServer: async () => async () => {}
  };

  const sqlitePath = join(tmpdir(), `rx-backtest-${crypto.randomUUID()}.sqlite`);
  const configOverrides = buildEnvOverrides(symbol, options, sqlitePath);

  const startInit = performance.now();
  const handle = await startEngine({
    live: false,
    registerSignalHandlers: false,
    clock: scheduler,
    configOverrides,
    dependencies
  });
  const afterStartup = performance.now();

  for (const tick of sortedTicks) {
    scheduler.advanceTo(tick.t);
    latestTick = tick;
    feedAdapter.push(tick);
  }
  feedAdapter.complete();
  const afterReplay = performance.now();

  // allow any microtasks (async persistence appends) to settle
  await delay(0);
  const afterSettle = performance.now();

  handle.stop();
  const afterStop = performance.now();

  try {
    rmSync(sqlitePath, { force: true });
  } catch {
    // best effort cleanup
  }

  const events = await eventStore.read();
  const positions = await buildProjection(eventStore, positionsProjection);
  const pnl = await buildProjection(eventStore, pnlProjection);
  const navCurve = events
    .filter((evt) => evt.type === 'pnl.analytics')
    .map((evt) => ({ t: (evt.data as any).t as number, nav: (evt.data as any).nav as number }));

  const stats = computeBacktestStats({
    ticks: sortedTicks,
    events,
    navCurve,
    pnl,
    timings: {
      wallRuntimeMs: afterStop - wallStart,
      startupMs: afterStartup - startInit,
      replayMs: afterReplay - afterStartup,
      settleMs: afterSettle - afterReplay,
      teardownMs: afterStop - afterSettle
    }
  });

  const clock: BacktestClockMetadata = {
    type: 'backtest-scheduler',
    startMs: sortedTicks[0]!.t,
    endMs: sortedTicks[sortedTicks.length - 1]!.t,
    spanMs: sortedTicks.length > 1 ? sortedTicks[sortedTicks.length - 1]!.t - sortedTicks[0]!.t : 0,
    ticks: sortedTicks.length
  };

  return { events, positions, pnl, navCurve, stats, clock };
};

export { loadTicks } from './loaders';

interface ComputeStatsOptions {
  ticks: MarketTick[];
  events: DomainEvent[];
  navCurve: Array<{ t: number; nav: number }>;
  pnl: PnlState;
  timings: {
    wallRuntimeMs: number;
    startupMs: number;
    replayMs: number;
    settleMs: number;
    teardownMs: number;
  };
}

const computeBacktestStats = ({ ticks, events, navCurve, pnl, timings }: ComputeStatsOptions): BacktestStats => {
  const tickSpanMs = ticks.length > 1 ? ticks[ticks.length - 1]!.t - ticks[0]!.t : 0;
  const wallRuntimeMs = Math.max(timings.wallRuntimeMs, 0);
  const ticksPerSecond = wallRuntimeMs > 0 ? ticks.length / (wallRuntimeMs / 1000) : ticks.length;
  const eventsPerSecond = wallRuntimeMs > 0 ? events.length / (wallRuntimeMs / 1000) : events.length;
  const nav = computeNavStats(navCurve, pnl.latest?.nav ?? 0);
  const eventCounts = countEvents(events);

  return {
    wallRuntimeMs,
    startupMs: Math.max(timings.startupMs, 0),
    replayMs: Math.max(timings.replayMs, 0),
    settleMs: Math.max(timings.settleMs, 0),
    teardownMs: Math.max(timings.teardownMs, 0),
    ticksProcessed: ticks.length,
    tickSpanMs,
    ticksPerSecond,
    eventsPerSecond,
    eventCounts,
    nav
  };
};

const computeNavStats = (navCurve: Array<{ t: number; nav: number }>, latestNav: number): NavStats => {
  if (!navCurve.length) {
    return {
      startNav: latestNav,
      endNav: latestNav,
      change: 0,
      changePct: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      sharpe: 0,
      volatility: 0,
      samples: 0
    };
  }
  const sorted = [...navCurve].sort((a, b) => a.t - b.t);
  const startNav = sorted[0]!.nav ?? latestNav;
  const endNav = sorted[sorted.length - 1]!.nav ?? latestNav;
  const change = endNav - startNav;
  const changePct = startNav !== 0 ? change / startNav : 0;
  let peak = sorted[0]!.nav;
  let maxDrawdown = 0;
  for (const sample of sorted) {
    if (sample.nav > peak) {
      peak = sample.nav;
    }
    const drawdown = peak - sample.nav;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  const maxDrawdownPct = peak > 0 ? -(maxDrawdown / peak) : 0;
  const returns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!.nav;
    const curr = sorted[i]!.nav;
    if (prev === 0) continue;
    returns.push((curr - prev) / prev);
  }
  const samples = returns.length;
  const mean = samples ? returns.reduce((acc, value) => acc + value, 0) / samples : 0;
  const variance = samples > 1
    ? returns.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (samples - 1)
    : 0;
  const volatility = Math.sqrt(variance);
  const sharpe = volatility > 0 ? (mean / volatility) * Math.sqrt(samples) : 0;

  return {
    startNav,
    endNav,
    change,
    changePct,
    maxDrawdown,
    maxDrawdownPct,
    sharpe,
    volatility,
    samples
  };
};

const countEvents = (events: DomainEvent[]): EventCountStats => {
  return events.reduce<EventCountStats>(
    (acc, event) => {
      switch (event.type) {
        case 'order.new':
          acc.orderNew += 1;
          break;
        case 'order.ack':
          acc.orderAck += 1;
          break;
        case 'order.reject':
          acc.orderReject += 1;
          break;
        case 'order.fill':
          acc.orderFill += 1;
          break;
        case 'pnl.analytics':
          acc.pnlAnalytics += 1;
          break;
        case 'portfolio.snapshot':
          acc.portfolioSnapshots += 1;
          break;
        default:
          break;
      }
      return acc;
    },
    {
      orderNew: 0,
      orderAck: 0,
      orderReject: 0,
      orderFill: 0,
      pnlAnalytics: 0,
      portfolioSnapshots: 0
    }
  );
};
