import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export interface Metrics {
  register: Registry;
  ticksIngested: Counter;
  ordersSubmitted: Counter;
  riskRejected: Counter;
  portfolioNav: Gauge;
  feedReconnects: Counter;
  feedStatus: Gauge;
  feedTickAge: Gauge;
  persistenceQueueDepth: Gauge;
  persistenceQueueDrops: Counter;
  persistenceInlineWrites: Counter;
  executionRetries: Counter;
  executionFailures: Counter;
  executionCircuitState: Gauge;
  executionCircuitTrips: Counter;
  executionPendingIntents: Gauge;
  executionStaleIntents: Counter;
  eventStoreAppendDuration: Histogram;
  eventStoreReadDuration: Histogram;
  balanceSyncFailures: Counter;
  balanceSyncStatus: Gauge;
  balanceSyncLastSuccess: Gauge;
  balanceSyncDriftBps: Gauge;
  accountTransfersRequested: Counter;
  accountTransfersExecuted: Counter;
  accountTransfersFailed: Counter;
}

export const createMetrics = (): Metrics => {
  const register = new Registry();
  collectDefaultMetrics({ register });

  const ticksIngested = new Counter({
    name: 'ticks_ingested_total',
    help: 'Total normalized market ticks',
    registers: [register]
  });

  const ordersSubmitted = new Counter({
    name: 'orders_submitted_total',
    help: 'Orders emitted by orchestrator',
    registers: [register]
  });

  const riskRejected = new Counter({
    name: 'risk_rejected_total',
    help: 'Orders/fills rejected by risk checks',
    registers: [register]
  });

  const portfolioNav = new Gauge({
    name: 'portfolio_nav',
    help: 'Latest computed portfolio net asset value',
    registers: [register]
  });

  const feedReconnects = new Counter({
    name: 'feed_reconnects_total',
    help: 'Number of feed reconnect attempts',
    labelNames: ['feed'],
    registers: [register]
  });

  const feedStatus = new Gauge({
    name: 'feed_status',
    help: 'Feed connectivity status (1=connected, 0=disconnected)',
    labelNames: ['feed'],
    registers: [register]
  });

  const feedTickAge = new Gauge({
    name: 'feed_last_tick_age_seconds',
    help: 'Seconds since last tick was observed for a feed',
    labelNames: ['feed'],
    registers: [register]
  });

  const persistenceQueueDepth = new Gauge({
    name: 'persistence_queue_depth',
    help: 'Current depth of the shared persistence event queue',
    registers: [register]
  });

  const persistenceQueueDrops = new Counter({
    name: 'persistence_queue_drops_total',
    help: 'Events dropped due to a full persistence queue',
    registers: [register]
  });

  const persistenceInlineWrites = new Counter({
    name: 'persistence_inline_writes_total',
    help: 'Events persisted synchronously because the queue was saturated',
    registers: [register]
  });

  const executionRetries = new Counter({
    name: 'execution_retries_total',
    help: 'Total retries attempted when submitting orders to exchanges',
    labelNames: ['venue'],
    registers: [register]
  });

  const executionFailures = new Counter({
    name: 'execution_failures_total',
    help: 'Number of execution attempts that exhausted retries or failed fatally',
    labelNames: ['venue', 'reason'],
    registers: [register]
  });

  const executionCircuitState = new Gauge({
    name: 'execution_circuit_state',
    help: 'Circuit breaker state per venue (0=closed, 0.5=half-open, 1=open)',
    labelNames: ['venue'],
    registers: [register]
  });

  const executionCircuitTrips = new Counter({
    name: 'execution_circuit_trips_total',
    help: 'Number of times an execution circuit breaker opened',
    labelNames: ['venue'],
    registers: [register]
  });

  const executionPendingIntents = new Gauge({
    name: 'execution_pending_intents',
    help: 'Orders pending acknowledgement or fill',
    labelNames: ['venue'],
    registers: [register]
  });

  const executionStaleIntents = new Counter({
    name: 'execution_stale_intents_total',
    help: 'Orders flagged by the reconciliation worker as stale',
    labelNames: ['venue', 'reason'],
    registers: [register]
  });

  const balanceSyncFailures = new Counter({
    name: 'balance_sync_failures_total',
    help: 'Number of balance sync attempts that failed',
    labelNames: ['venue'],
    registers: [register]
  });

  const balanceSyncStatus = new Gauge({
    name: 'balance_sync_status',
    help: 'Balance sync status per venue (1=ok, 0=error)',
    labelNames: ['venue'],
    registers: [register]
  });

  const balanceSyncLastSuccess = new Gauge({
    name: 'balance_sync_last_success_seconds',
    help: 'Timestamp (unix seconds) of the last successful balance sync per venue',
    labelNames: ['venue'],
    registers: [register]
  });

  const balanceSyncDriftBps = new Gauge({
    name: 'balance_sync_drift_bps',
    help: 'Last observed drift between provider and projection (basis points)',
    labelNames: ['venue'],
    registers: [register]
  });

  const accountTransfersRequested = new Counter({
    name: 'account_transfers_requested_total',
    help: 'Number of transfer requests observed by the executor',
    labelNames: ['from', 'to', 'asset'],
    registers: [register]
  });

  const accountTransfersExecuted = new Counter({
    name: 'account_transfers_executed_total',
    help: 'Number of transfer requests that were fulfilled automatically',
    labelNames: ['provider', 'asset'],
    registers: [register]
  });

  const accountTransfersFailed = new Counter({
    name: 'account_transfers_failed_total',
    help: 'Number of automated transfer attempts that failed',
    labelNames: ['provider', 'asset'],
    registers: [register]
  });

  const eventStoreAppendDuration = new Histogram({
    name: 'event_store_append_duration_seconds',
    help: 'Latency to append events to the configured event store',
    labelNames: ['driver'],
    buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register]
  });

  const eventStoreReadDuration = new Histogram({
    name: 'event_store_read_duration_seconds',
    help: 'Latency to read events from the configured event store',
    labelNames: ['driver', 'mode'],
    buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register]
  });

  return {
    register,
    ticksIngested,
    ordersSubmitted,
    riskRejected,
    portfolioNav,
    feedReconnects,
    feedStatus,
    feedTickAge,
    persistenceQueueDepth,
    persistenceQueueDrops,
    persistenceInlineWrites,
    executionRetries,
    executionFailures,
    executionCircuitState,
    executionCircuitTrips,
    executionPendingIntents,
    executionStaleIntents,
    eventStoreAppendDuration,
    eventStoreReadDuration,
    balanceSyncFailures,
    balanceSyncStatus,
    balanceSyncLastSuccess,
    balanceSyncDriftBps,
    accountTransfersRequested,
    accountTransfersExecuted,
    accountTransfersFailed
  };
};
