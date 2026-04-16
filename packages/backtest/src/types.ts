import type { DomainEvent } from '@rx-trader/core/domain';
import type { pnlProjection, positionsProjection } from '@rx-trader/event-store';
import type { TickDatasetMetadata } from './loaders';

export interface BacktestSummary {
  symbol: string;
  dataset: TickDatasetMetadata;
  ticksUsed: number;
  events: number;
  nav: number;
  pnl: number;
  maxDrawdown: number;
  ticksPerSecond: number;
  sharpe: number;
  maxDrawdownPct: number;
  runtimeMs: number;
}

export interface BacktestClockEngineMetadata {
  type: 'backtest-scheduler';
  startMs: number;
  endMs: number;
  spanMs: number;
  ticks: number;
}

export interface BacktestClockScriptMetadata {
  source: string;
  startMs: number;
  env: string | null;
  capturedMs: number;
}

export interface BacktestClockDatasetMetadata {
  startMs: number | null;
  endMs: number | null;
}

export interface BacktestClockMetadata {
  engine: BacktestClockEngineMetadata;
  script: BacktestClockScriptMetadata;
  dataset: BacktestClockDatasetMetadata;
}

export interface BacktestStats {
  wallRuntimeMs: number;
  startupMs: number;
  replayMs: number;
  settleMs: number;
  teardownMs: number;
  ticksProcessed: number;
  tickSpanMs: number;
  ticksPerSecond: number;
  eventsPerSecond: number;
  eventCounts: {
    orderNew: number;
    orderAck: number;
    orderReject: number;
    orderFill: number;
    pnlAnalytics: number;
    portfolioSnapshots: number;
  };
  nav: {
    startNav: number;
    endNav: number;
    change: number;
    changePct: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    sharpe: number;
    volatility: number;
    samples: number;
  };
}

export interface BacktestArtifact {
  summary: BacktestSummary;
  clock: BacktestClockMetadata;
  navCurve: Array<{ t: number; nav: number }>;
  positions: ReturnType<typeof positionsProjection.init>;
  pnl: ReturnType<typeof pnlProjection.init>;
  events: DomainEvent[];
  stats: BacktestStats;
}

export interface BacktestHistoryEntry {
  id: string;
  ts: number;
  summary: Partial<BacktestSummary> | null;
  stats?: Partial<BacktestStats> | null;
}
