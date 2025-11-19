import { EMPTY, merge, share } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';
import type { OrderNew } from '@rx-trader/core/domain';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';
import type { AccountExposureGuard } from '@rx-trader/risk/preTrade';
import { splitRiskStream } from '@rx-trader/risk';
import type { ExecutionPolicyConfig, StrategyDefinition } from '@rx-trader/config';
import type { Metrics } from '@rx-trader/observability/metrics';
import { createFeedManager as defaultCreateFeedManager, type FeedManagerResult } from './feedManager';
import { createStrategy$ as defaultCreateStrategy$ } from './strategyManager';
import { createIntentBuilder as defaultCreateIntentBuilder } from '@rx-trader/strategies';
import type { StrategySignal } from '@rx-trader/strategies';
import type { RuntimeStrategyConfig, StrategyMarginConfig } from './types';
import type { RiskConfig } from './riskManager';
import type { EventBus } from '@rx-trader/core';

export interface StrategyOrchestratorOptions {
  strategies: RuntimeStrategyConfig[];
  executionAccount: string;
  executionPolicy: ExecutionPolicyConfig;
  baseRisk: RiskConfig;
  eventBus: EventBus;
  clock?: Clock;
  accountGuard?: AccountExposureGuard;
  createFeedManager?: typeof defaultCreateFeedManager;
  createStrategy$?: typeof defaultCreateStrategy$;
  createIntentBuilder?: typeof defaultCreateIntentBuilder;
  metrics?: Metrics;
  onFeedTick?: () => void;
}

export interface StrategyRuntime {
  definition: StrategyDefinition;
  mode: 'live' | 'sandbox';
  priority: number;
  feedManager: FeedManagerResult;
  signals$: Observable<StrategySignal>;
  intents$: Observable<OrderNew>;
  rawIntents$: Observable<OrderNew>;
  rejects$: Observable<any>;
  fees?: RuntimeStrategyConfig['fees'];
  margin?: StrategyMarginConfig;
  exit?: RuntimeStrategyConfig['exit'];
}

export interface StrategyOrchestratorResult {
  feedManager: FeedManagerResult;
  intents$: Observable<OrderNew>;
  runtimes: StrategyRuntime[];
}

export const createStrategyOrchestrator = (
  options: StrategyOrchestratorOptions
): StrategyOrchestratorResult => {
  if (!options.strategies.length) {
    throw new Error('At least one strategy definition is required');
  }

  const feedManagerFactory = options.createFeedManager ?? defaultCreateFeedManager;
  const strategyFactory = options.createStrategy$ ?? defaultCreateStrategy$;
  const intentBuilderFactory = options.createIntentBuilder ?? defaultCreateIntentBuilder;
  const clock = options.clock ?? systemClock;
  const eventBus = options.eventBus;

  const runtimes: StrategyRuntime[] = options.strategies.map((runtimeConfig) => {
    const { definition } = runtimeConfig;
    const feedManager = feedManagerFactory({
      symbol: definition.tradeSymbol,
      primaryFeed: definition.primaryFeed,
      extraFeeds: definition.extraFeeds,
      onTick: () => options.onFeedTick?.(),
      metrics: options.metrics
    });

    const rawSignals$ = strategyFactory({
      strategy: definition,
      feedManager,
      onExternalFeedTick: () => options.onFeedTick?.()
    }).pipe(
      tap((signal) => {
        eventBus.emit({
          id: crypto.randomUUID(),
          type: 'strategy.signal',
          data: {
            strategyId: definition.id,
            symbol: definition.tradeSymbol,
            side: signal.action,
            strength: 1.0, // Default strength as it's not in StrategySignal
            reasons: [] // No reasons in StrategySignal
          },
          ts: clock.now(),
          traceId: crypto.randomUUID(), // Start a new trace for this signal
          metadata: {}
        });
      }),
      share()
    );

    const feeAwarePolicy = {
      ...options.executionPolicy,
      makerFeeBps: runtimeConfig.fees?.makerBps ?? options.executionPolicy.makerFeeBps,
      takerFeeBps: runtimeConfig.fees?.takerBps ?? options.executionPolicy.takerFeeBps
    };

    const buildIntents = intentBuilderFactory({
      account: options.executionAccount,
      policy: feeAwarePolicy as any,
      tickSize: runtimeConfig.tickSize,
      lotSize: runtimeConfig.lotSize,
      now: clock.now.bind(clock),
      strategyId: definition.id,
      feeSource: runtimeConfig.fees?.source
    });

    const strategyIntents$ = buildIntents(rawSignals$, feedManager.marks$).pipe(
      tap((intent) => {
        // We don't have easy access to the signal's traceId here without threading it through buildIntents.
        // For now, we'll emit the intent event. Future improvement: thread traceId.
        const meta = intent.meta as Record<string, unknown> | undefined;
        eventBus.emit({
          id: crypto.randomUUID(),
          type: 'strategy.intent',
          data: {
            strategyId: definition.id,
            symbol: intent.symbol,
            side: intent.side as 'BUY' | 'SELL',
            qty: intent.qty,
            targetSize: (meta?.targetSize as number) ?? undefined,
            urgency: (meta?.urgency as any) ?? undefined
          },
          ts: clock.now(),
          metadata: meta
        });
      }),
      share()
    );

    const [budgetApproved$, budgetRejected$] = splitRiskStream(
      strategyIntents$,
      buildStrategyRiskLimits(definition, options.baseRisk),
      clock,
      options.accountGuard
    );

    const approvedOrders$ = budgetApproved$.pipe(map((decision) => decision.order), share());
    const liveIntents$ = definition.mode === 'sandbox' ? EMPTY : approvedOrders$;
    const intents$ = liveIntents$.pipe(share());

    return {
      definition,
      mode: definition.mode,
      priority: definition.priority,
      feedManager,
      signals$: rawSignals$,
      intents$,
      rawIntents$: strategyIntents$,
      rejects$: budgetRejected$,
      fees: runtimeConfig.fees,
      margin: runtimeConfig.margin,
      exit: runtimeConfig.exit
    } satisfies StrategyRuntime;
  });

  const mergedIntents$ = merge(...runtimes.map((runtime) => runtime.intents$)).pipe(share());

  const compositeFeedManager = combineFeedManagers(runtimes.map((runtime) => runtime.feedManager));

  return {
    feedManager: compositeFeedManager,
    intents$: mergedIntents$,
    runtimes
  } satisfies StrategyOrchestratorResult;
};

const buildStrategyRiskLimits = (
  definition: StrategyDefinition,
  baseRisk: RiskConfig
): RiskConfig => ({
  notional: definition.budget?.notional ?? baseRisk.notional,
  maxPosition: definition.budget?.maxPosition ?? baseRisk.maxPosition,
  priceBands: baseRisk.priceBands,
  throttle: definition.budget?.throttle ?? baseRisk.throttle
});

const combineFeedManagers = (feedManagers: FeedManagerResult[]): FeedManagerResult => {
  const uniqueManagers = Array.from(new Set(feedManagers));
  if (uniqueManagers.length === 1) {
    return uniqueManagers[0]!;
  }
  const marks$ = merge(...uniqueManagers.map((manager) => manager.marks$)).pipe(share());
  const sources = uniqueManagers.flatMap((manager) => manager.sources);
  const debugFeeds = process.env.DEBUG_FEEDS === '1';
  const stop = () => {
    uniqueManagers.forEach((manager) => {
      try {
        manager.stop();
      } catch (error) {
        if (debugFeeds) {
          console.warn('Failed to stop feed manager', error);
        }
      }
    });
  };
  return {
    marks$,
    sources,
    stop
  } satisfies FeedManagerResult;
};
