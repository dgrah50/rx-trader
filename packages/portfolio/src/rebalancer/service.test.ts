import { describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { RebalanceService } from './service';
import type { EventStore } from '@rx-trader/event-store';
import type { DomainEvent } from '@rx-trader/core/domain';
import type { LoggerInstance, MetricsInstance } from '@rx-trader/pipeline';

const createLoggerStub = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }) as unknown as LoggerInstance;

const createStore = (events: DomainEvent[] | (() => Promise<DomainEvent[]>)) =>
  ({
    append: vi.fn(),
    stream$: new Subject(),
    read: typeof events === 'function' ? events : vi.fn(async () => events)
  }) as unknown as EventStore;

const createBalanceEvent = (params: {
  venue: 'paper' | 'binance' | 'hyperliquid';
  asset: string;
  delta: number;
  accountId?: string;
}): DomainEvent<'account.balance.adjusted'> => {
  const t = Date.now();
  return {
    id: crypto.randomUUID(),
    type: 'account.balance.adjusted',
    ts: t,
    data: {
      id: crypto.randomUUID(),
      t,
      accountId: params.accountId ?? 'acct-demo',
      venue: params.venue,
      asset: params.asset,
      delta: params.delta,
      reason: 'sync'
    }
  };
};

const metricsStub = {} as unknown as MetricsInstance;

describe('RebalanceService', () => {
  it('enqueues transfer requests when targets dictate a rebalance', async () => {
    const store = createStore([
      createBalanceEvent({ venue: 'binance', asset: 'USDT', delta: 9000 }),
      createBalanceEvent({ venue: 'hyperliquid', asset: 'USDT', delta: 500 })
    ]);
    const enqueue = vi.fn();
    const service = new RebalanceService({
      store,
      targets: [
        { venue: 'hyperliquid', asset: 'USDT', min: 4000 },
        { venue: 'binance', asset: 'USDT', max: 6000 }
      ],
      intervalMs: 0,
      logger: createLoggerStub(),
      metrics: metricsStub,
      accountId: 'acct-demo',
      enqueue
    });

    await service.start();

    expect(enqueue).toHaveBeenCalledTimes(1);
    const event = enqueue.mock.calls[0][0];
    expect(event.type).toBe('account.transfer.requested');
    expect(event.data).toMatchObject({
      accountId: 'acct-demo',
      fromVenue: 'binance',
      toVenue: 'hyperliquid',
      asset: 'USDT'
    });
    expect(service.getTelemetry().lastPlan?.transfers).toHaveLength(1);
  });

  it('does nothing when no rebalance is required', async () => {
    const store = createStore([
      createBalanceEvent({ venue: 'binance', asset: 'USDT', delta: 5000 }),
      createBalanceEvent({ venue: 'hyperliquid', asset: 'USDT', delta: 5000 })
    ]);
    const enqueue = vi.fn();
    const logger = createLoggerStub();
    const service = new RebalanceService({
      store,
      targets: [{ venue: 'binance', asset: 'USDT', min: 4000 }],
      intervalMs: 0,
      logger,
      metrics: metricsStub,
      accountId: 'acct-demo',
      enqueue
    });

    await service.start();

    expect(enqueue).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { component: 'rebalancer', status: 'ok' },
      'No rebalance needed'
    );
  });

  it('logs and swallows errors from projection evaluation', async () => {
    const logger = createLoggerStub();
    const error = new Error('boom');
    const store = createStore(async () => {
      throw error;
    });
    const service = new RebalanceService({
      store,
      targets: [{ venue: 'binance', asset: 'USDT', target: 1000 }],
      intervalMs: 0,
      logger,
      metrics: metricsStub,
      accountId: 'acct-demo',
      enqueue: vi.fn()
    });

    await expect(service.start()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      { component: 'rebalancer', err: error },
      'Rebalance evaluation failed'
    );
  });
});
