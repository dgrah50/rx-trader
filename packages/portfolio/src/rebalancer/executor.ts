import type { Subscription } from 'rxjs';
import type { EventStore } from '@rx-trader/event-store';
import type { DomainEvent, AccountTransfer } from '@rx-trader/core/domain';
import { accountTransferSchema, accountBalanceAdjustedSchema } from '@rx-trader/core/domain';
import { safeParse } from '@rx-trader/core/validation';
import type { LoggerInstance, MetricsInstance } from '@rx-trader/pipeline';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';
import type { TransferProvider } from './providers';

interface TransferExecutionServiceOptions {
  enabled: boolean;
  store: EventStore;
  enqueue: (event: DomainEvent) => void;
  providers: TransferProvider[];
  logger: LoggerInstance;
  metrics: MetricsInstance;
  clock?: Clock;
}

export class TransferExecutionService {
  private subscription?: Subscription;
  private readonly clock: Clock;
  private readonly inFlight = new Set<string>();

  constructor(private readonly options: TransferExecutionServiceOptions) {
    this.clock = options.clock ?? systemClock;
  }

  start() {
    if (!this.options.enabled || !this.options.providers.length) {
      this.options.logger.info(
        { component: 'rebalancer', enabled: this.options.enabled },
        'Transfer executor disabled (no providers or auto-execute off)'
      );
      return;
    }
    this.subscription = this.options.store.stream$.subscribe((event) => {
      if (event.type === 'account.transfer.requested') {
        void this.handleRequest(event as DomainEvent<'account.transfer.requested'>);
      }
    });
  }

  stop() {
    this.subscription?.unsubscribe();
  }

  private async handleRequest(event: DomainEvent<'account.transfer.requested'>) {
    const transfer = safeParse(accountTransferSchema, event.data, { force: true });
    this.options.metrics.accountTransfersRequested.inc({
      from: transfer.fromVenue,
      to: transfer.toVenue,
      asset: transfer.asset
    });
    const lockKey = `${transfer.fromVenue}:${transfer.toVenue}:${transfer.asset}`;
    if (this.inFlight.has(lockKey)) {
      this.options.logger.info(
        { component: 'rebalancer', requestId: transfer.id, lockKey },
        'Transfer already in-flight; skipping duplicate request'
      );
      return;
    }

    const provider = this.options.providers.find((candidate) => candidate.canHandle(transfer));
    if (!provider) {
      this.options.logger.warn(
        { component: 'rebalancer', requestId: transfer.id },
        'No transfer provider available; leaving request pending'
      );
      return;
    }

    this.inFlight.add(lockKey);
    try {
      await this.executeTransfer(provider, transfer, event);
    } finally {
      this.inFlight.delete(lockKey);
    }
  }

  private async executeTransfer(
    provider: TransferProvider,
    transfer: AccountTransfer,
    sourceEvent: DomainEvent
  ) {
    const labels = { provider: provider.id, asset: transfer.asset };
    try {
      const result = await provider.execute(transfer);
      const now = this.clock.now();
      const completedTransfer = safeParse(
        accountTransferSchema,
        {
          ...transfer,
          t: now
        },
        { force: true }
      );

      const debit = safeParse(
        accountBalanceAdjustedSchema,
        {
          id: crypto.randomUUID(),
          t: now,
          accountId: transfer.accountId,
          venue: transfer.fromVenue,
          asset: transfer.asset,
          delta: -result.amount,
          reason: 'transfer',
          metadata: { provider: provider.id, requestId: transfer.id }
        },
        { force: true }
      );

      const credit = safeParse(
        accountBalanceAdjustedSchema,
        {
          id: crypto.randomUUID(),
          t: now,
          accountId: transfer.accountId,
          venue: transfer.toVenue,
          asset: transfer.asset,
          delta: result.amount,
          reason: 'transfer',
          metadata: { provider: provider.id, requestId: transfer.id }
        },
        { force: true }
      );

      this.options.enqueue({
        id: crypto.randomUUID(),
        type: 'account.transfer',
        data: completedTransfer,
        ts: now,
        metadata: {
          provider: provider.id,
          requestId: transfer.id,
          sourceEventId: sourceEvent.id
        }
      });

      this.options.enqueue({
        id: crypto.randomUUID(),
        type: 'account.balance.adjusted',
        data: debit,
        ts: now
      });

      this.options.enqueue({
        id: crypto.randomUUID(),
        type: 'account.balance.adjusted',
        data: credit,
        ts: now
      });

      this.options.metrics.accountTransfersExecuted.inc(labels);
    } catch (error) {
      this.options.metrics.accountTransfersFailed.inc(labels);
      this.options.logger.error(
        {
          component: 'rebalancer',
          provider: provider.id,
          requestId: transfer.id,
          error: error instanceof Error ? error.message : String(error)
        },
        'Automated transfer execution failed'
      );
    }
  }
}
