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
  // Legacy methods kept for compatibility during transition, but they now just emit to bus or are no-ops if bus handles it
  recordOrder: (order: OrderNew) => void;
  recordFill: (fill: Fill) => void;
  recordRiskReject: (order: OrderNew, reasons?: string[]) => void;
  recordExecutionReject: (reject: OrderReject) => void;
  recordExit: (strategyId: string, reason?: string) => void;
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
  strategies: StrategyDefinition[];
  eventBus: EventBus;
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
      fees: undefined, // Fees are runtime config, not definition. Can be added if needed.
      margin: undefined, // Margin is runtime config.
      metrics: createInitialMetrics(),
      exits: createExitMetrics(),
      definition: definition
    };
    entries.set(entry.id, entry);
  });

  // Subscribe to EventBus
  subs.push(
    params.eventBus.on('strategy.signal').subscribe((event) => {
      const entry = entries.get(event.data.strategyId);
      if (entry) {
        entry.metrics.signals += 1;
        entry.metrics.lastSignalTs = event.ts;
      }
    })
  );

  subs.push(
    params.eventBus.on('strategy.intent').subscribe((event) => {
      const entry = entries.get(event.data.strategyId);
      if (entry) {
        entry.metrics.intents += 1;
        entry.metrics.lastIntentTs = event.ts;
      }
    })
  );

  subs.push(
    params.eventBus.on('order.new').subscribe((event) => {
      const order = event.data as OrderNew;
      const strategyId = selectStrategyId(order, symbolFallbacks);
      if (!strategyId) return;
      const entry = entries.get(strategyId);
      if (!entry) return;
      orderToStrategy.set(order.id, strategyId);
      entry.metrics.orders += 1;
      entry.metrics.lastOrderTs = event.ts;
    })
  );

  subs.push(
    params.eventBus.on('order.fill').subscribe((event) => {
      const fill = event.data as Fill;
      const strategyId = orderToStrategy.get(fill.orderId);
      if (!strategyId) return;
      const entry = entries.get(strategyId);
      if (!entry) return;
      entry.metrics.fills += 1;
      entry.metrics.lastFillTs = event.ts;
      // Don't delete mapping yet, might have multiple fills
    })
  );

  subs.push(
    params.eventBus.on('order.reject').subscribe((event) => {
      const reject = event.data as OrderReject; // or generic reject data
      // OrderReject has id, but it might be orderId.
      // Check domain/orders.ts: OrderReject { id: string ... } where id is orderId?
      // Usually reject.id is the orderId.
      let strategyId = orderToStrategy.get(reject.id);
      if (!strategyId && typeof event.metadata?.strategyId === 'string') {
        strategyId = event.metadata.strategyId;
      }
      if (!strategyId) return;
      const entry = entries.get(strategyId);
      if (!entry) return;
      entry.metrics.rejects += 1;
      entry.metrics.lastRejectTs = event.ts;
    })
  );

  // Manual recording methods (for compatibility with startEngine until fully switched)
  // These can now be no-ops if startEngine emits events to bus.
  // But startEngine hasn't been updated yet.
  // So we'll keep them working by manually triggering the logic or emitting to bus?
  // Better: make them emit to bus!
  
  const recordOrder = (order: OrderNew) => {
    // If startEngine calls this, we can just emit to bus.
    // But startEngine might also emit to bus later.
    // To avoid loops, let's just rely on the bus subscription above.
    // If startEngine is NOT emitting to bus yet, we need to do it here?
    // No, startEngine will be updated next.
    // For now, let's make these methods emit to the bus if they are called.
    // This ensures backward compatibility.
    params.eventBus.emit({
        id: crypto.randomUUID(),
        type: 'order.new',
        data: order,
        ts: clock.now()
    });
  };

  const recordFill = (fill: Fill) => {
    params.eventBus.emit({
        id: crypto.randomUUID(),
        type: 'order.fill',
        data: fill,
        ts: clock.now()
    });
  };

  const recordRiskReject = (order: OrderNew, reasons?: string[]) => {
    // This is a bit tricky because it's a reject of an order that might not be in the system yet?
    // Or it is.
    // We can emit order.reject
    const strategyId = selectStrategyId(order, symbolFallbacks);
    params.eventBus.emit({
        id: crypto.randomUUID(),
        type: 'order.reject',
        data: {
            id: order.id,
            t: clock.now(),
            reason: reasons?.join(', ') ?? 'risk-reject'
        },
        ts: clock.now(),
        metadata: { reasons, strategyId: strategyId ?? undefined }
    });
  };

  const recordExecutionReject = (reject: OrderReject) => {
    params.eventBus.emit({
        id: crypto.randomUUID(),
        type: 'order.reject',
        data: reject,
        ts: clock.now()
    });
  };

  const recordExit = (strategyId: string, reason?: string) => {
      // Exits are special. They might not be events yet.
      // But we can just update the entry directly or emit a custom event?
      // Let's update entry directly for now as 'exit' isn't a standard domain event yet (maybe it should be?)
      // Actually, we can just keep the logic here.
      const entry = entries.get(strategyId);
      if (!entry) return;

      entry.metrics.intents += 1;
      entry.metrics.lastIntentTs = clock.now();

      if (reason) {
        entry.exits.total += 1;
        entry.exits.byReason[reason] = (entry.exits.byReason[reason] ?? 0) + 1;
        entry.exits.lastReason = reason;
        entry.exits.lastTs = clock.now();
      }
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
