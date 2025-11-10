import { filter, map, share } from 'rxjs';
import type { Observable } from 'rxjs';
import type { Fill, DomainEvent, OrderAck, OrderReject } from '@rx-trader/core/domain';
import type { AppConfig } from '@rx-trader/config';
import {
  PaperExecutionAdapter,
  BinanceRestGateway,
  type ExecutionAdapter
} from '@rx-trader/execution';
import { ExecutionVenue } from '@rx-trader/core/constants';
import type { Clock } from '@rx-trader/core/time';
import type { Metrics } from '@rx-trader/observability/metrics';
import type { Logger } from 'pino';
import { createExecutionPolicy } from './executionPolicy';

interface ExecutionManagerOptions {
  live: boolean;
  config: AppConfig;
  enqueue: (event: DomainEvent) => void;
  clock: Clock;
  metrics: Metrics;
  logger: Logger;
}

interface ExecutionManager {
  adapter: ExecutionAdapter;
  events$: Observable<DomainEvent>;
  fills$: Observable<Fill>;
  acks$: Observable<OrderAck>;
  rejects$: Observable<OrderReject>;
  submit: (order: Parameters<ExecutionAdapter['submit']>[0]) => Promise<void>;
}

export const createExecutionManager = (
  options: ExecutionManagerOptions
): ExecutionManager => {
  const adapter =
    options.live && options.config.venues?.binance
      ? new BinanceRestGateway(options.config.venues.binance, options.clock)
      : new PaperExecutionAdapter(
          options.live ? `${ExecutionVenue.Paper}-live` : `${ExecutionVenue.Paper}-demo`,
          options.clock
        );

  const events$ = adapter.events$.pipe(share());

  events$.subscribe((event) => {
    options.enqueue(event as DomainEvent);
  });

  const fills$ = events$.pipe(
    filter((event) => event.type === 'order.fill'),
    map((event) => event.data as Fill),
    share()
  );

  const acks$ = events$.pipe(
    filter((event) => event.type === 'order.ack'),
    map((event) => event.data as OrderAck),
    share()
  );

  const rejects$ = events$.pipe(
    filter((event) => event.type === 'order.reject'),
    map((event) => event.data as OrderReject),
    share()
  );

  const policy = createExecutionPolicy({
    adapter,
    config: {
      retry: options.config.execution.reliability.retry,
      circuitBreaker: options.config.execution.reliability.circuitBreaker
    },
    metrics: options.metrics,
    logger: options.logger,
    clock: options.clock
  });

  return {
    adapter,
    events$,
    fills$,
    acks$,
    rejects$,
    submit: (order) => policy.submit(order)
  };
};
