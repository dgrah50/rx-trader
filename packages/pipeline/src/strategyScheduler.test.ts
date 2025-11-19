import { describe, expect, it } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ExecutionPolicyConfig, StrategyDefinition } from '@rx-trader/config';
import { FeedType, StrategyType } from '@rx-trader/core/constants';
import type { FeedManagerResult } from './feedManager';
import type { RuntimeStrategyConfig } from './types';
import type { OrderNew } from '@rx-trader/core/domain';
import type { StrategySignal } from '@rx-trader/strategies';
import { createStrategyOrchestrator } from './strategyScheduler';

const basePolicy: ExecutionPolicyConfig = {
  mode: 'market',
  defaultQty: 1,
  limitOffsetBps: 0,
  minEdgeBps: 0,
  makerFeeBps: 0,
  takerFeeBps: 0,
  tif: 'DAY',
  notionalUsd: 0,
  takerSlipBps: 0,
  adverseSelectionBps: 0,
  postOnly: false,
  reduceOnly: false,
  cooldownMs: 0,
  dedupeWindowMs: 0,
  makerTimeoutMs: 0,
  repriceBps: 0
};

const baseRisk = {
  notional: 100000,
  maxPosition: 10,
  priceBands: {},
  throttle: { windowMs: 1000, maxCount: 5 }
};

const makeDefinition = (overrides: Partial<StrategyDefinition> = {}): StrategyDefinition => ({
  id: overrides.id ?? 'strat-1',
  mode: overrides.mode ?? 'live',
  priority: overrides.priority ?? 0,
  type: overrides.type ?? StrategyType.Momentum,
  tradeSymbol: overrides.tradeSymbol ?? 'BTCUSDT',
  primaryFeed: overrides.primaryFeed ?? FeedType.Binance,
  extraFeeds: overrides.extraFeeds ?? [],
  params: overrides.params ?? {},
  budget: overrides.budget ?? {
    notional: 100000,
    maxPosition: 5,
    throttle: { windowMs: 1000, maxCount: 2 }
  },
  exit: overrides.exit ?? { enabled: false }
});

const makeFeedManager = (symbol: string): FeedManagerResult => ({
  marks$: of({ symbol, t: Date.now(), last: 100 } as any),
  sources: [],
  stop: () => {}
});

import { EventBus } from '@rx-trader/core';

// ... existing imports

// ... existing setup

describe('createStrategyOrchestrator', () => {
  const signalStream = of<StrategySignal>({
    symbol: 'BTCUSDT',
    action: 'BUY',
    px: 100,
    t: Date.now()
  });

  const intentBuilderStub = (opts?: { strategyId?: string }) => (signals$: typeof signalStream) =>
    signals$.pipe(
      map((signal) => ({
        id: `order-${signal.symbol}`,
        t: signal.t,
        symbol: signal.symbol,
        side: 'BUY',
        qty: 1,
        type: 'MKT',
        tif: 'DAY',
        account: 'TEST',
        meta: opts?.strategyId ? { strategyId: opts.strategyId } : undefined
      } satisfies OrderNew))
    );

  it('emits intents for live strategies', async () => {
    const strategies: RuntimeStrategyConfig[] = [{ definition: makeDefinition({ id: 'live' }) }];
    const eventBus = new EventBus();

    const orchestrator = createStrategyOrchestrator({
      strategies,
      executionAccount: 'TEST',
      executionPolicy: basePolicy,
      baseRisk,
      eventBus,
      createFeedManager: () => makeFeedManager('BTCUSDT'),
      createStrategy$: () => signalStream,
      createIntentBuilder: intentBuilderStub
    });

    const order = await firstValueFrom(orchestrator.intents$);
    expect(order?.symbol).toBe('BTCUSDT');
    expect(order?.meta?.strategyId).toBe('live');
    expect(orchestrator.runtimes[0]?.signals$).toBeDefined();
  });

  it('suppresses sandbox strategies from emitting intents', async () => {
    const strategies: RuntimeStrategyConfig[] = [
      { definition: makeDefinition({ id: 'sandbox', mode: 'sandbox' }) }
    ];
    const eventBus = new EventBus();

    const orchestrator = createStrategyOrchestrator({
      strategies,
      executionAccount: 'TEST',
      executionPolicy: basePolicy,
      baseRisk,
      eventBus,
      createFeedManager: () => makeFeedManager('BTCUSDT'),
      createStrategy$: () => signalStream,
      createIntentBuilder: intentBuilderStub
    });

    let received = false;
    const sub = orchestrator.intents$.subscribe(() => {
      received = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    sub.unsubscribe();
    expect(received).toBe(false);
  });
});
