import { filter, map, share } from 'rxjs';
import type { Observable } from 'rxjs';
import type {
  Fill,
  DomainEvent,
  OrderAck,
  OrderReject,
  OrderNew,
  OrderCancelReq
} from '@rx-trader/core/domain';
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
  feeDefaults?: {
    makerBps: number;
    takerBps: number;
  };
}

interface ExecutionManager {
  adapter: ExecutionAdapter;
  events$: Observable<DomainEvent>;
  fills$: Observable<Fill>;
  acks$: Observable<OrderAck>;
  rejects$: Observable<OrderReject>;
  submit: (order: Parameters<ExecutionAdapter['submit']>[0]) => Promise<void>;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

type PendingFeeMeta = {
  feeBps: number;
  liquidity: 'MAKER' | 'TAKER';
};

const extractFeeMeta = (
  order: OrderNew,
  defaults: { maker: number; taker: number }
): PendingFeeMeta => {
  const meta = order.meta as Record<string, unknown> | undefined;
  const liquidity =
    meta?.liquidity === 'MAKER' || meta?.liquidity === 'TAKER'
      ? (meta.liquidity as 'MAKER' | 'TAKER')
      : order.type === 'LMT'
        ? 'MAKER'
        : 'TAKER';
  const fallback = liquidity === 'MAKER' ? defaults.maker : defaults.taker;
  const feeBps = numberOrNull(meta?.expectedFeeBps) ?? fallback ?? 0;
  return { feeBps, liquidity };
};

const applyFeeToFill = (fill: Fill, meta: PendingFeeMeta): Fill => {
  let updated = fill;
  let changed = false;
  if (fill.fee == null && Number.isFinite(fill.px) && Number.isFinite(fill.qty)) {
    const fee = Math.abs(fill.px * fill.qty * (meta.feeBps / 10_000));
    if (Number.isFinite(fee)) {
      updated = { ...updated, fee };
      changed = true;
    }
  }
  if (!updated.liquidity && meta.liquidity) {
    updated = changed ? { ...updated, liquidity: meta.liquidity } : { ...updated, liquidity: meta.liquidity };
    changed = true;
  }
  return changed ? updated : fill;
};

export const createExecutionManager = (
  options: ExecutionManagerOptions
): ExecutionManager => {
  const feeDefaults = {
    maker: options.feeDefaults?.makerBps ?? options.config.execution.policy.makerFeeBps ?? 0,
    taker: options.feeDefaults?.takerBps ?? options.config.execution.policy.takerFeeBps ?? 0
  };
  const pendingFees = new Map<string, PendingFeeMeta>();

  const adapter =
    options.live && options.config.venues?.binance
      ? new BinanceRestGateway(options.config.venues.binance, options.clock)
      : new PaperExecutionAdapter(
          options.live ? `${ExecutionVenue.Paper}-live` : `${ExecutionVenue.Paper}-demo`,
          options.clock
        );

  const purgePending = (orderId?: string | null) => {
    if (!orderId) return;
    pendingFees.delete(orderId);
  };

  const events$ = adapter.events$
    .pipe(
      map((event) => {
        if (event.type === 'order.fill') {
          const fill = event.data as Fill;
          const meta = pendingFees.get(fill.orderId);
          if (!meta) {
            return event;
          }
          const updated = applyFeeToFill(fill, meta);
          purgePending(fill.orderId);
          return updated === fill ? event : { ...event, data: updated };
        }
        if (event.type === 'order.reject') {
          purgePending((event.data as OrderReject).id);
        } else if (event.type === 'order.cancel') {
          purgePending((event.data as OrderCancelReq).id);
        }
        return event;
      })
    )
    .pipe(share());

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
    submit: async (order) => {
      pendingFees.set(order.id, extractFeeMeta(order, feeDefaults));
      try {
        await policy.submit(order);
      } catch (error) {
        pendingFees.delete(order.id);
        throw error;
      }
    }
  };
};
