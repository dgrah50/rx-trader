import type { Observable, Subscription } from 'rxjs';
import type { OrderAck, OrderNew, OrderReject, Fill } from '@rx-trader/core/domain';
import type { Clock } from '@rx-trader/core/time';
import type { Logger } from 'pino';
import type { ExecutionAdapter } from '@rx-trader/execution';
import type { Metrics } from '@rx-trader/observability/metrics';

interface IntentReconcilerConfig {
  ackTimeoutMs: number;
  fillTimeoutMs: number;
  pollIntervalMs: number;
}

interface PendingIntent {
  order: OrderNew;
  submittedAt: number;
  ackedAt?: number;
  alertedAck?: boolean;
  alertedFill?: boolean;
  cancelAttempted?: boolean;
}

interface IntentReconciler {
  track(order: OrderNew): () => void;
  stop(): void;
}

interface IntentReconcilerOptions {
  config: IntentReconcilerConfig;
  clock: Clock;
  logger: Logger;
  metrics?: Metrics;
  adapter: ExecutionAdapter;
  ack$: Observable<OrderAck>;
  fills$: Observable<Fill>;
  rejects$: Observable<OrderReject>;
}

export const createIntentReconciler = ({
  config,
  clock,
  logger,
  metrics,
  adapter,
  ack$,
  fills$,
  rejects$
}: IntentReconcilerOptions): IntentReconciler => {
  const pending = new Map<string, PendingIntent>();
  const subscriptions: Subscription[] = [];
  const venue = adapter.id;

  const updatePendingGauge = () => {
    metrics?.executionPendingIntents.labels({ venue }).set(pending.size);
  };

  const remove = (orderId: string) => {
    if (pending.delete(orderId)) {
      updatePendingGauge();
    }
  };

  subscriptions.push(
    ack$.subscribe((ack) => {
      const entry = pending.get(ack.id);
      if (!entry) return;
      entry.ackedAt = ack.t;
      entry.alertedAck = false;
      entry.cancelAttempted = false;
    })
  );

  subscriptions.push(
    fills$.subscribe((fill) => {
      remove(fill.orderId);
    })
  );

  subscriptions.push(
    rejects$.subscribe((reject) => {
      remove(reject.id);
    })
  );

  const alert = (entry: PendingIntent, reason: 'ack-timeout' | 'fill-timeout') => {
    metrics?.executionStaleIntents.labels({ venue, reason }).inc();
    logger.warn(
      {
        venue,
        orderId: entry.order.id,
        symbol: entry.order.symbol,
        ageMs: clock.now() - entry.submittedAt,
        reason
      },
      'Intent reconciliation alert'
    );
    if (!entry.cancelAttempted) {
      entry.cancelAttempted = true;
      void adapter
        .cancel(entry.order.id)
        .catch((error) =>
          logger.error({ venue, orderId: entry.order.id, error: error instanceof Error ? error.message : error }, 'Failed to cancel stale order')
        );
    }
  };

  const checkPending = () => {
    const now = clock.now();
    pending.forEach((entry) => {
      if (!entry.ackedAt) {
        if (now - entry.submittedAt >= config.ackTimeoutMs && !entry.alertedAck) {
          entry.alertedAck = true;
          alert(entry, 'ack-timeout');
        }
        return;
      }
      if (now - entry.ackedAt >= config.fillTimeoutMs && !entry.alertedFill) {
        entry.alertedFill = true;
        alert(entry, 'fill-timeout');
      }
    });
  };

  const timer = setInterval(checkPending, config.pollIntervalMs);

  const track = (order: OrderNew) => {
    pending.set(order.id, {
      order,
      submittedAt: clock.now()
    });
    updatePendingGauge();
    return () => {
      remove(order.id);
    };
  };

  const stop = () => {
    clearInterval(timer);
    subscriptions.forEach((sub) => sub.unsubscribe());
    pending.clear();
    updatePendingGauge();
  };

  return { track, stop };
};
