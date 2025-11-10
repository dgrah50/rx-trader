import { createControlPlaneRouter } from '@rx-trader/control-plane/app';
import type { AppConfig } from '@rx-trader/config';
import type { createEventStore } from '@rx-trader/event-store';
import type { LoggerInstance, MetricsInstance } from '@rx-trader/pipeline';
import type { BalanceSyncTelemetry } from '@rx-trader/portfolio';

type EventStoreInstance = Awaited<ReturnType<typeof createEventStore>>;

interface ApiServerOptions {
  config: AppConfig;
  store: EventStoreInstance;
  logger: LoggerInstance;
  metrics: MetricsInstance;
  live?: boolean;
  accounting?: {
    balanceTelemetry?: () => BalanceSyncTelemetry;
  };
  rebalancer?: () => unknown;
}

export const startApiServer = async (options: ApiServerOptions) => {
  const handler = await createControlPlaneRouter(options.config, {
    store: options.store,
    logger: options.logger,
    metrics: options.metrics,
    runtimeMeta: { live: options.live ?? false },
    accounting: {
      balanceTelemetry: options.accounting?.balanceTelemetry,
      rebalancer: options.rebalancer
    }
  });
  const server = Bun.serve({ port: options.config.gateway.port, fetch: handler, idleTimeout: 120 });
  return () => server.stop();
};
