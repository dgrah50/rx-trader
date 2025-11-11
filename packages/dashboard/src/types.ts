export interface StrategyMetrics {
  signals: number;
  intents: number;
  orders: number;
  fills: number;
  rejects: number;
  lastSignalTs: number | null;
  lastIntentTs: number | null;
  lastOrderTs: number | null;
  lastFillTs: number | null;
  lastRejectTs: number | null;
}

export interface StrategyBudgetSummary {
  notional?: number;
  maxPosition?: number;
  throttle?: { windowMs: number; maxCount: number };
}

export interface StrategyRuntimeStatus {
  id: string;
  type: string;
  tradeSymbol: string;
  primaryFeed: string;
  extraFeeds: string[];
  mode: 'live' | 'sandbox';
  priority: number;
  budget?: StrategyBudgetSummary;
  params?: Record<string, unknown>;
  fees?: {
    makerBps: number;
    takerBps: number;
    source?: string;
  };
  margin?: StrategyMarginInfo;
  metrics?: StrategyMetrics;
}

export interface StrategyMarginInfo {
  mode: 'cash' | 'margin' | 'perp';
  leverageCap: number;
  productType: 'SPOT' | 'PERP';
}

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

export interface PnlResponse {
  nav: number;
  realized: number;
  unrealized: number;
}

export interface PositionsResponse {
  [symbol: string]: { pos: number; avgPx: number; px: number; pnl: number };
}

export interface LogEntry {
  id: string;
  t: number;
  level: string;
  name: string;
  msg: string;
  data?: Record<string, unknown>;
}

export interface BacktestSummary {
  symbol: string;
  ticksUsed: number;
  events: number;
  sharpe: number;
  maxDrawdownPct: number;
  runtimeMs: number;
}

export interface BacktestArtifact {
  summary: BacktestSummary;
  navCurve: Array<{ t: number; nav: number }>;
}

export interface BacktestHistoryEntry {
  id: string;
  ts: number;
  summary: BacktestSummary | null;
}

export interface FeedHealthSnapshot {
  id: string;
  status: 'connecting' | 'connected' | 'disconnected';
  reconnects: number;
  lastTickTs: number | null;
  ageSeconds: number | null;
}

export interface BalanceEntry {
  venue: string;
  asset: string;
  available: number;
  locked: number;
  total: number;
  lastUpdated: number;
}

export interface AccountBalancesResponse {
  balances: Record<string, Record<string, BalanceEntry>>;
  updated: number | null;
}

export interface MarginSummary {
  venue: string;
  equity: number;
  marginUsed: number;
  maintenance: number;
  leverageCap?: number;
  collateralAsset: string;
}

export interface AccountMarginResponse {
  summaries: Record<string, MarginSummary>;
  updated: number | null;
}

export interface BalanceSyncTelemetry {
  venue: string;
  provider: string;
  lastRunMs: number | null;
  lastSuccessMs: number | null;
  lastError?: { message: string; ts: number } | null;
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
    unrealized: number | null;
    eventSubscribers: number;
    logSubscribers: number;
    lastEventTs: number | null;
    lastLogTs: number | null;
  };
  accounting?: {
    balanceSync?: BalanceSyncTelemetry | null;
  };
}

export interface EventMessage {
  id: string;
  type: string;
  ts: number;
  data?: Record<string, unknown>;
}

export interface OrderEvent {
  id: string;
  type: string;
  ts: number;
  data?: Record<string, unknown>;
}
