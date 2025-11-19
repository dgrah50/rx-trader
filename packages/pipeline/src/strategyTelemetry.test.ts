import { describe, it, expect } from 'vitest';
import { createStrategyTelemetry } from './strategyTelemetry';
import { FeedType, StrategyType } from '@rx-trader/core/constants';
import { EventBus } from '@rx-trader/core';
import type { StrategyDefinition } from '@rx-trader/config';

const createDefinition = (id: string): StrategyDefinition => ({
  id,
  type: StrategyType.Momentum,
  tradeSymbol: 'BTCUSDT',
  primaryFeed: FeedType.Binance,
  extraFeeds: [],
  params: {},
  mode: 'live',
  priority: 0,
  budget: {},
  exit: { enabled: false, logVerbose: false }
});

describe('createStrategyTelemetry', () => {
  it('tracks strategy metrics across signals, intents, orders, fills, and rejects', () => {
    const definition = createDefinition('strat-A');
    const eventBus = new EventBus();
    const telemetry = createStrategyTelemetry({ strategies: [definition], eventBus });

    // Emit signals and intents via EventBus
    eventBus.emit({
      id: 'sig-1',
      type: 'strategy.signal',
      data: { strategyId: 'strat-A', symbol: 'BTCUSDT', side: 'BUY', strength: 1 },
      ts: Date.now()
    });
    eventBus.emit({
      id: 'sig-2',
      type: 'strategy.signal',
      data: { strategyId: 'strat-A', symbol: 'BTCUSDT', side: 'BUY', strength: 1 },
      ts: Date.now()
    });
    eventBus.emit({
      id: 'int-1',
      type: 'strategy.intent',
      data: { strategyId: 'strat-A', symbol: 'BTCUSDT', side: 'BUY', qty: 1 },
      ts: Date.now()
    });

    const orderId = 'order-1';
    // Use recordOrder which now emits to bus (or emit directly to bus to test decoupling)
    // Let's use recordOrder to verify backward compat/convenience, but also verify bus listening.
    telemetry.recordOrder({
      id: orderId,
      t: Date.now(),
      symbol: 'BTCUSDT',
      side: 'BUY',
      qty: 1,
      type: 'MKT',
      tif: 'DAY',
      account: 'ACC',
      meta: { strategyId: 'strat-A' }
    });

    telemetry.recordFill({
      id: 'fill-1',
      orderId,
      t: Date.now(),
      symbol: 'BTCUSDT',
      px: 100,
      qty: 1,
      side: 'BUY'
    });

    const rejectedOrderId = 'order-2';
    telemetry.recordOrder({
      id: rejectedOrderId,
      t: Date.now(),
      symbol: 'BTCUSDT',
      side: 'SELL',
      qty: 0.5,
      type: 'MKT',
      tif: 'DAY',
      account: 'ACC',
      meta: { strategyId: 'strat-A' }
    });
    telemetry.recordExecutionReject({ id: rejectedOrderId, t: Date.now(), reason: 'cancelled' });

    const snapshot = telemetry.snapshot();
    expect(snapshot).toHaveLength(1);
    const snapshotEntry = snapshot[0]!;
    const metrics = snapshotEntry.metrics;
    expect(metrics.signals).toBe(2);
    expect(metrics.intents).toBe(1);
    expect(metrics.orders).toBe(2);
    expect(metrics.fills).toBe(1);
    expect(metrics.rejects).toBe(1);
  });

  it('uses symbol fallbacks when strategy metadata is missing', () => {
    const definition = createDefinition('strat-B');
    const eventBus = new EventBus();
    const telemetry = createStrategyTelemetry({ strategies: [definition], eventBus });

    telemetry.recordRiskReject({
      id: 'order-x',
      t: Date.now(),
      symbol: 'BTCUSDT',
      side: 'SELL',
      qty: 0.5,
      type: 'MKT',
      tif: 'DAY',
      account: 'ACC'
    });

    const metrics = telemetry.snapshot()[0]!.metrics;
    expect(metrics.rejects).toBe(1);
  });

  it('records exit counts and reasons per strategy', () => {
    const definition = createDefinition('strat-exit');
    const eventBus = new EventBus();
    const telemetry = createStrategyTelemetry({ strategies: [definition], eventBus });

    telemetry.recordExit('strat-exit', 'EXIT_TIME');
    telemetry.recordExit('strat-exit', 'EXIT_TIME');
    telemetry.recordExit('strat-exit', 'EXIT_TP');

    const snapshot = telemetry.snapshot()[0]!;
    expect(snapshot.exits.total).toBe(3);
    expect(snapshot.exits.byReason.EXIT_TIME).toBe(2);
    expect(snapshot.exits.byReason.EXIT_TP).toBe(1);
    expect(snapshot.exits.lastReason).toBe('EXIT_TP');
    expect(snapshot.exits.lastTs).toBeGreaterThan(0);
  });
});
