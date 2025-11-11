import type { Subscription } from 'rxjs';
import type { OrderNew, Fill, OrderReject } from '@rx-trader/core/domain';
import { systemClock, type Clock } from '@rx-trader/core/time';
import type { StrategyRuntime } from './strategyScheduler';
import type {
  StrategyBudgetConfig,
  StrategyDefinition,
  StrategyMode
} from '@rx-trader/config';
import type { StrategyMarginConfig } from './types';

interface StrategyMetrics {
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

interface ExitMetrics {
  total: number;
  byReason: Record<string, number>;
  lastReason: string | null;
  lastTs: number | null;
}

export interface StrategyTelemetrySnapshot {
  id: string;
  type: StrategyDefinition['type'];
  tradeSymbol: string;
  primaryFeed: StrategyDefinition['primaryFeed'];
  extraFeeds: StrategyDefinition['extraFeeds'];
  mode: StrategyMode;
  priority: number;
  budget?: StrategyBudgetConfig;
  params?: StrategyDefinition['params'];
  fees?: {
    makerBps: number;
    takerBps: number;
    source?: string;
  };
  margin?: StrategyMarginConfig;
  metrics: StrategyMetrics;
  exits: ExitMetrics;
}

export interface StrategyTelemetry {
  recordOrder: (order: OrderNew) => void;
  recordFill: (fill: Fill) => void;
  recordRiskReject: (order: OrderNew, reasons?: string[]) => void;
  recordExecutionReject: (reject: OrderReject) => void;
  recordExit: (strategyId: string, reason?: string) => void;
  snapshot: () => StrategyTelemetrySnapshot[];
  stop: () => void;
}

interface TelemetryEntry extends StrategyTelemetrySnapshot {
  definition: StrategyDefinition;
}

const createInitialMetrics = (): StrategyMetrics => ({
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

const createExitMetrics = (): ExitMetrics => ({
  total: 0,
  byReason: {},
  lastReason: null,
  lastTs: null
});

const snapshotEntry = (entry: TelemetryEntry): StrategyTelemetrySnapshot => ({
  id: entry.id,
  type: entry.type,
  tradeSymbol: entry.tradeSymbol,
  primaryFeed: entry.primaryFeed,
  extraFeeds: entry.extraFeeds,
  mode: entry.mode,
  priority: entry.priority,
  budget: entry.budget,
  params: entry.params,
  fees: entry.fees,
  margin: entry.margin,
  metrics: { ...entry.metrics },
  exits: {
    total: entry.exits.total,
    byReason: { ...entry.exits.byReason },
    lastReason: entry.exits.lastReason,
    lastTs: entry.exits.lastTs
  }
});

const selectStrategyId = (
  order: Pick<OrderNew, 'meta' | 'symbol'>,
  fallbacks: Map<string, string[]>
) => {
  const metaId = order.meta?.strategyId;
  if (typeof metaId === 'string' && metaId.length) {
    return metaId;
  }
  const ids = fallbacks.get(order.symbol.toUpperCase());
  return ids?.[0] ?? null;
};

export const createStrategyTelemetry = (params: {
  runtimes: StrategyRuntime[];
  clock?: Clock;
}): StrategyTelemetry => {
  const clock = params.clock ?? systemClock;
  const entries = new Map<string, TelemetryEntry>();
  const orderToStrategy = new Map<string, string>();
  const symbolFallbacks = new Map<string, string[]>();
  const subs: Subscription[] = [];

  const trackSymbol = (definition: StrategyDefinition) => {
    const symbol = definition.tradeSymbol.toUpperCase();
    const current = symbolFallbacks.get(symbol) ?? [];
    if (!current.includes(definition.id)) {
      current.push(definition.id);
      symbolFallbacks.set(symbol, current);
    }
  };

  params.runtimes.forEach((runtime) => {
    trackSymbol(runtime.definition);
    const entry: TelemetryEntry = {
      id: runtime.definition.id,
      type: runtime.definition.type,
      tradeSymbol: runtime.definition.tradeSymbol,
      primaryFeed: runtime.definition.primaryFeed,
      extraFeeds: runtime.definition.extraFeeds ?? [],
      mode: runtime.definition.mode,
      priority: runtime.definition.priority ?? 0,
      budget: runtime.definition.budget,
      params: runtime.definition.params ?? {},
      fees: runtime.fees,
      margin: runtime.margin,
      metrics: createInitialMetrics(),
      exits: createExitMetrics(),
      definition: runtime.definition
    };
    entries.set(entry.id, entry);

    subs.push(
      runtime.signals$.subscribe({
        next: () => {
          entry.metrics.signals += 1;
          entry.metrics.lastSignalTs = clock.now();
        }
      })
    );

    subs.push(
      runtime.intents$.subscribe({
        next: () => {
          entry.metrics.intents += 1;
          entry.metrics.lastIntentTs = clock.now();
        }
      })
    );
  });

  const recordOrder = (order: OrderNew) => {
    const strategyId = selectStrategyId(order, symbolFallbacks);
    if (!strategyId) return;
    const entry = entries.get(strategyId);
    if (!entry) return;
    orderToStrategy.set(order.id, strategyId);
    entry.metrics.orders += 1;
    entry.metrics.lastOrderTs = clock.now();
  };

  const recordFill = (fill: Fill) => {
    const strategyId = orderToStrategy.get(fill.orderId);
    if (!strategyId) return;
    const entry = entries.get(strategyId);
    if (!entry) return;
    entry.metrics.fills += 1;
    entry.metrics.lastFillTs = clock.now();
    orderToStrategy.delete(fill.orderId);
  };

  const recordRiskReject = (order: OrderNew) => {
    const strategyId = selectStrategyId(order, symbolFallbacks);
    if (!strategyId) return;
    const entry = entries.get(strategyId);
    if (!entry) return;
    entry.metrics.rejects += 1;
    entry.metrics.lastRejectTs = clock.now();
  };

  const recordExecutionReject = (reject: OrderReject) => {
    const strategyId = orderToStrategy.get(reject.id);
    if (!strategyId) return;
    const entry = entries.get(strategyId);
    if (!entry) return;
    entry.metrics.rejects += 1;
    entry.metrics.lastRejectTs = clock.now();
    orderToStrategy.delete(reject.id);
  };

  const recordExit = (strategyId: string, reason?: string) => {
    if (!reason) return;
    const entry = entries.get(strategyId);
    if (!entry) return;
    entry.exits.total += 1;
    entry.exits.byReason[reason] = (entry.exits.byReason[reason] ?? 0) + 1;
    entry.exits.lastReason = reason;
    entry.exits.lastTs = clock.now();
  };

  const snapshot = () => Array.from(entries.values()).map((entry) => snapshotEntry(entry));

  const stop = () => {
    subs.forEach((sub) => sub.unsubscribe());
    subs.length = 0;
    orderToStrategy.clear();
  };

  return {
    recordOrder,
    recordFill,
    recordRiskReject,
    recordExecutionReject,
    recordExit,
    snapshot,
    stop
  };
};
