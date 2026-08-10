import type { AppConfig, EnvOverrides } from '@rx-trader/config';
import type { OrderNew, PortfolioAnalytics, PortfolioSnapshot } from '@rx-trader/core/domain';
import type { Clock } from '@rx-trader/core/time';
import type { createEventStore, createPersistenceManager } from '@rx-trader/event-store';
import type {
  FeedManagerResult,
  InstrumentMetadata,
  createFeedManager,
  createExecutionManager,
  createStrategy$
} from '@rx-trader/pipeline';
import type { BalanceProvider } from '@rx-trader/portfolio';
import type { createIntentBuilder } from '@rx-trader/strategies';
import type { startApiServer } from './apiServer';

export interface BalanceProviderFactoryInput {
  instrument: InstrumentMetadata;
  config: AppConfig;
  feedManager: FeedManagerResult;
  live: boolean;
}

export interface RuntimeDependencies {
  createFeedManager?: typeof createFeedManager;
  createExecutionManager?: typeof createExecutionManager;
  createEventStore?: typeof createEventStore;
  createPersistenceManager?: typeof createPersistenceManager;
  createIntentBuilder?: typeof createIntentBuilder;
  createStrategy$?: typeof createStrategy$;
}

export interface EngineDependencies extends RuntimeDependencies {
  startApiServer?: typeof startApiServer;
  createBalanceProvider?: (input: BalanceProviderFactoryInput) => BalanceProvider;
}

export interface StartEngineOptions {
  live?: boolean;
  registerSignalHandlers?: boolean;
  persistPortfolioUpdatesImmediately?: boolean;
  configOverrides?: EnvOverrides;
  clock?: Clock;
  dependencies?: EngineDependencies;
  hooks?: {
    onExitIntent?: (order: OrderNew) => void;
    onSnapshot?: (snapshot: PortfolioSnapshot) => void;
    onAnalytics?: (analytics: PortfolioAnalytics) => void;
  };
}
