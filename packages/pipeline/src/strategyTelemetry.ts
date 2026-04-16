import type { Subscription } from 'rxjs';
import type { OrderNew, Fill, OrderReject } from '@rx-trader/core/domain';
import { systemClock, type Clock } from '@rx-trader/core/time';
import type {
  StrategyBudgetConfig,
  StrategyDefinition,
  StrategyMode
} from '@rx-trader/config';
import type { StrategyMarginConfig } from './types';
import type { EventBus } from '@rx-trader/core';

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
  snapshot: () => StrategyTelemetrySnapshot[];
  stop: () => void;
  recordOrder: (order: OrderNew) => void;
  recordFill: (fill: Fill) => void;
  recordRiskReject: (order: OrderNew, reasons?: string[]) => void;
  recordExecutionReject: (reject: OrderReject) => void;
  recordExit: (strategyId: string, reason?: string) => void;
}

type TelemetryEntry = StrategyTelemetrySnapshot;

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
  strategiesBySymbol: Map<string, string[]>
) => {
  const metaId = order.meta?.strategyId;
  if (typeof metaId === 'string' && metaId.length) {
    return metaId;
  }
  const ids = strategiesBySymbol.get(order.symbol.toUpperCase());
  return ids?.[0] ?? null;
};

export const createStrategyTelemetry = (params: {
  strategies: StrategyDefinition[];
  eventBus: EventBus;
  clock?: Clock;
}): StrategyTelemetry => {
  const clock = params.clock ?? systemClock;
  const entries = new Map<string, TelemetryEntry>();
  const orderToStrategy = new Map<string, string>();
  const strategiesBySymbol = new Map<string, string[]>();
  const subs: Subscription[] = [];

  const trackSymbol = (definition: StrategyDefinition) => {
    const symbol = definition.tradeSymbol.toUpperCase();
    const current = strategiesBySymbol.get(symbol) ?? [];
    if (!current.includes(definition.id)) {
      current.push(definition.id);
      strategiesBySymbol.set(symbol, current);
    }
  };

  params.strategies.forEach((definition) => {
    trackSymbol(definition);
    const entry: TelemetryEntry = {
      id: definition.id,
      type: definition.type,
      tradeSymbol: definition.tradeSymbol,
      primaryFeed: definition.primaryFeed,
      extraFeeds: definition.extraFeeds ?? [],
      mode: definition.mode,
      priority: definition.priority ?? 0,
      budget: definition.budget,
      params: definition.params ?? {},
      fees: undefined,
      margin: undefined,
      metrics: createInitialMetrics(),
      exits: createExitMetrics()
    };
    entries.set(entry.id, entry);
  });

  const recordSignal = (strategyId: string, ts: number) => {
    const entry = entries.get(strategyId);
    if (!entry) return;
    entry.metrics.signals += 1;
    entry.metrics.lastSignalTs = ts;
  };

  const recordIntent = (strategyId: string, ts: number) => {
    const entry = entries.get(strategyId);
    if (!entry) return;
    entry.metrics.intents += 1;
    entry.metrics.lastIntentTs = ts;
  };

  const recordRiskCheck = (strategyId: string, ts: number) => {
    const entry = entries.get(strategyId);
    if (!entry) return;
    entry.metrics.rejects += 1;
    entry.metrics.lastRejectTs = ts;
  };

  const recordOrderMetrics = (strategyId: string, orderId: string, ts: number) => {
    const entry = entries.get(strategyId);
    if (!entry) return;
    orderToStrategy.set(orderId, strategyId);
    entry.metrics.orders += 1;
    entry.metrics.lastOrderTs = ts;
  };

  const recordFillMetrics = (orderId: string, ts: number) => {
    const strategyId = orderToStrategy.get(orderId);
    if (!strategyId) return;
    const entry = entries.get(strategyId);
    if (!entry) return;
    entry.metrics.fills += 1;
    entry.metrics.lastFillTs = ts;
  };

  const recordRejectMetrics = (strategyId: string, rejectId: string, ts: number) => {
    const entry = entries.get(strategyId);
    if (!entry) return;
    orderToStrategy.set(rejectId, strategyId);
    entry.metrics.rejects += 1;
    entry.metrics.lastRejectTs = ts;
  };

  const recordExitMetrics = (strategyId: string, reason: string | undefined, ts: number) => {
    const entry = entries.get(strategyId);
    if (!entry) return;

    entry.metrics.intents += 1;
    entry.metrics.lastIntentTs = ts;

    if (reason) {
      entry.exits.total += 1;
      entry.exits.byReason[reason] = (entry.exits.byReason[reason] ?? 0) + 1;
      entry.exits.lastReason = reason;
      entry.exits.lastTs = ts;
    }
  };

  type StrategySignalEventData = {
    strategyId: string;
  };

  type StrategyIntentEventData = {
    strategyId: string;
  };

  type RiskCheckEventData = {
    passed: boolean;
    metadata?: { strategyId?: string };
  };

  subs.push(
    params.eventBus.on('strategy.signal').subscribe((event) => {
      const data = event.data as StrategySignalEventData;
      recordSignal(data.strategyId, event.ts);
    })
  );

  subs.push(
    params.eventBus.on('strategy.intent').subscribe((event) => {
      const data = event.data as StrategyIntentEventData;
      recordIntent(data.strategyId, event.ts);
    })
  );

  subs.push(
    params.eventBus.on('risk.check').subscribe((event) => {
      const data = event.data as RiskCheckEventData;
      const strategyId = data.metadata?.strategyId;
      if (!strategyId || data.passed) return;
      recordRiskCheck(strategyId, event.ts);
    })
  );

  subs.push(
    params.eventBus.on('order.new').subscribe((event) => {
      const order = event.data as OrderNew;
      const strategyId = selectStrategyId(order, strategiesBySymbol);
      if (!strategyId) return;
      recordOrderMetrics(strategyId, order.id, event.ts);
    })
  );

  subs.push(
    params.eventBus.on('order.fill').subscribe((event) => {
      const fill = event.data as Fill;
      recordFillMetrics(fill.orderId, event.ts);
    })
  );

  subs.push(
    params.eventBus.on('order.reject').subscribe((event) => {
      const reject = event.data as OrderReject;
      const strategyId = orderToStrategy.get(reject.id);
      const resolvedStrategyId =
        strategyId ?? (typeof event.metadata?.strategyId === 'string' ? event.metadata.strategyId : null);
      if (!resolvedStrategyId) return;
      recordRejectMetrics(resolvedStrategyId, reject.id, event.ts);
    })
  );

  const recordOrder = (order: OrderNew) => {
    const strategyId = selectStrategyId(order, strategiesBySymbol);
    if (!strategyId) return;
    recordOrderMetrics(strategyId, order.id, clock.now());
  };

  const recordFill = (fill: Fill) => {
    recordFillMetrics(fill.orderId, clock.now());
  };

  const recordRiskReject = (order: OrderNew, _reasons?: string[]) => {
    const strategyId = selectStrategyId(order, strategiesBySymbol);
    if (!strategyId) return;
    recordRejectMetrics(strategyId, order.id, clock.now());
  };

  const recordExecutionReject = (reject: OrderReject) => {
    const strategyId = orderToStrategy.get(reject.id);
    if (!strategyId) return;
    recordRejectMetrics(strategyId, reject.id, clock.now());
  };

  const recordExit = (strategyId: string, reason?: string) => {
    recordExitMetrics(strategyId, reason, clock.now());
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
