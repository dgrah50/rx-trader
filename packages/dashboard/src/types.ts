import type {
  BalanceEntry as CoreBalanceEntry,
  BalanceSyncTelemetry as CoreBalanceSyncTelemetry,
  ClosedTrade as CoreClosedTrade,
  DomainEvent,
  MarginSummary as CoreMarginSummary,
  OpenTrade as CoreOpenTrade,
  PortfolioAnalytics,
  PositionMark,
  TradeDirection as CoreTradeDirection,
  TradesResponse as CoreTradesResponse
} from '@rx-trader/core/domain';
import type { FeedHealthSnapshot as PipelineFeedHealthSnapshot, StrategyTelemetrySnapshot } from '@rx-trader/pipeline';
import type { LogEntry as ObservabilityLogEntry } from '@rx-trader/observability';
import type {
  BacktestArtifact as CoreBacktestArtifact,
  BacktestSummary as CoreBacktestSummary,
  BacktestStats as CoreBacktestStats
} from '@rx-trader/backtest';

export type StrategyRuntimeStatus = StrategyTelemetrySnapshot;
export type StrategyMetrics = StrategyRuntimeStatus['metrics'];
export type StrategyMarginInfo = NonNullable<StrategyRuntimeStatus['margin']>;

export const createEmptyStrategyMetrics = (): StrategyMetrics => ({
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

export type PnlResponse = PortfolioAnalytics;
export type PositionSnapshot = PositionMark;
export type PositionsResponse = Record<string, PositionSnapshot>;
export type TradeDirection = CoreTradeDirection;
export type OpenTrade = CoreOpenTrade;
export type ClosedTrade = CoreClosedTrade;
export type TradesResponse = CoreTradesResponse;
export type LogEntry = ObservabilityLogEntry;
export type BacktestArtifact = CoreBacktestArtifact;
export interface BacktestHistoryEntry {
  id: string;
  ts: number;
  summary: Partial<CoreBacktestSummary> | null;
  stats?: Partial<CoreBacktestStats> | null;
}
export type FeedHealthSnapshot = PipelineFeedHealthSnapshot;
export interface BalanceEntry extends Omit<CoreBalanceEntry, 'venue'> {
  venue: string;
}
export interface MarginSummary extends Omit<CoreMarginSummary, 'venue'> {
  venue: string;
}
export type BalanceSyncTelemetry = CoreBalanceSyncTelemetry;
export type EventMessage = DomainEvent;
export type OrderEvent = DomainEvent;

export interface AccountBalancesResponse {
  balances: Record<string, Record<string, BalanceEntry>>;
  updated: number | null;
}

export interface AccountMarginResponse {
  summaries: Record<string, MarginSummary>;
  updated: number | null;
}

export interface StatusResponse {
  timestamp: number;
  app: { env: string; name: string; version: string };
  gateway: { port: number };
  runtime: {
    live: boolean;
    killSwitch: boolean;
    strategy: {
      type: string;
      tradeSymbol: string;
      primaryFeed: string;
      extraFeeds: string[];
      params: Record<string, unknown>;
      fees?: {
        makerBps: number;
        takerBps: number;
        source?: string;
      };
      margin?: StrategyMarginInfo;
    } | null;
    strategies?: StrategyRuntimeStatus[];
  };
  persistence: {
    driver: string;
    sqlitePath?: string;
  };
  feeds: FeedHealthSnapshot[];
  metrics: {
    nav: number | null;
    realized: number | null;
    netRealized: number | null;
    grossRealized: number | null;
    unrealized: number | null;
    feesPaid: number | null;
    eventSubscribers: number;
    logSubscribers: number;
    lastEventTs: number | null;
    lastLogTs: number | null;
  };
  accounting?: {
    balanceSync?: BalanceSyncTelemetry | null;
  };
}
