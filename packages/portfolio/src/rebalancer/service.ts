import { planRebalance, flattenBalancesState } from './plan';
import type { RebalanceTarget } from './types';
import { balancesProjection, buildProjection } from '@rx-trader/event-store';
import type { EventStore } from '@rx-trader/event-store';
import type { LoggerInstance, MetricsInstance } from '@rx-trader/pipeline';
import type { DomainEvent } from '@rx-trader/core/domain';
import { safeParse } from '@rx-trader/core/validation';
import { accountTransferSchema } from '@rx-trader/core/domain';

interface RebalanceServiceOptions {
  store: EventStore;
  targets: RebalanceTarget[];
  intervalMs: number;
  logger: LoggerInstance;
  metrics: MetricsInstance;
  accountId: string;
  enqueue: (event: DomainEvent) => void;
}

interface RebalanceTelemetry {
  lastRunMs: number | null;
  lastPlan?: ReturnType<typeof planRebalance>;
}

export class RebalanceService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private telemetry: RebalanceTelemetry = { lastRunMs: null };

  constructor(private readonly options: RebalanceServiceOptions) {}

  async start() {
    if (!this.options.targets.length) return;
    await this.evaluate();
    if (this.options.intervalMs > 0) {
      this.timer = setInterval(() => {
        void this.evaluate();
      }, this.options.intervalMs);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getTelemetry(): RebalanceTelemetry {
    return this.telemetry;
  }

  private async evaluate() {
    if (this.running) return;
    this.running = true;
    try {
      this.telemetry.lastRunMs = Date.now();
      const balancesState = await buildProjection(this.options.store, balancesProjection);
      const snapshots = flattenBalancesState(balancesState.balances ?? {});
      const plan = planRebalance(snapshots, this.options.targets);
      this.telemetry.lastPlan = plan;
      if (!plan.transfers.length) {
        this.options.logger.info({ component: 'rebalancer', status: 'ok' }, 'No rebalance needed');
        return;
      }
      plan.transfers.forEach((transfer) => {
        this.options.logger.warn(
          {
            component: 'rebalancer',
            transfer
          },
          'Rebalance transfer suggested'
        );
        const payload = safeParse(
          accountTransferSchema,
          {
            id: crypto.randomUUID(),
            t: Date.now(),
            accountId: this.options.accountId,
            fromVenue: transfer.from.venue,
            toVenue: transfer.to.venue,
            asset: transfer.from.asset,
            amount: transfer.amount
          },
          { force: true }
        );
        this.options.enqueue({
          id: crypto.randomUUID(),
          type: 'account.transfer.requested',
          data: payload,
          ts: payload.t,
          metadata: { reason: transfer.reason }
        });
      });
    } catch (error) {
      this.options.logger.error({ component: 'rebalancer', err: error }, 'Rebalance evaluation failed');
    } finally {
      this.running = false;
    }
  }
}
