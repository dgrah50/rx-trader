import { EMPTY, merge, share } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Observable } from 'rxjs';
import type { OrderNew, MarketTick } from '@rx-trader/core/domain';
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

export interface StrategyOrchestratorOptions {
  strategies: RuntimeStrategyConfig[];
  executionAccount: string;
  executionPolicy: ExecutionPolicyConfig;
  baseRisk: RiskConfig;
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
  fees?: RuntimeStrategyConfig['fees'];
  margin?: StrategyMarginConfig;
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
    }).pipe(share());

    const feeAwarePolicy = {
      ...options.executionPolicy,
      makerFeeBps: runtimeConfig.fees?.makerBps ?? options.executionPolicy.makerFeeBps,
      takerFeeBps: runtimeConfig.fees?.takerBps ?? options.executionPolicy.takerBps
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

    const strategyIntents$ = buildIntents(rawSignals$, feedManager.marks$).pipe(share());

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
      fees: runtimeConfig.fees,
      margin: runtimeConfig.margin
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
  if (feedManagers.length === 1) {
    return feedManagers[0]!;
  }
  const marks$ = merge(...feedManagers.map((manager) => manager.marks$)).pipe(share());
  const sources = feedManagers.flatMap((manager) => manager.sources);
  return {
    marks$,
    sources
  } satisfies FeedManagerResult;
};
