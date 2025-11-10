import { describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import type { EventStore } from '@rx-trader/event-store';
import type { DomainEvent } from '@rx-trader/core/domain';
import { TransferExecutionService } from './executor';
import { MockTransferProvider } from './providers';
import type { TransferProvider } from './providers';
import type { LoggerInstance, MetricsInstance } from '@rx-trader/pipeline';
import { createMetrics } from '@rx-trader/observability';

const createLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }) as unknown as LoggerInstance;

const makeStore = () =>
  ({
    append: vi.fn(),
    read: vi.fn(),
    stream$: new Subject<DomainEvent>()
  }) as unknown as EventStore;

const createTransferRequestedEvent = (
  overrides: Partial<DomainEvent<'account.transfer.requested'>['data']> = {}
): DomainEvent<'account.transfer.requested'> => {
  const t = Date.now();
  return {
    id: crypto.randomUUID(),
    type: 'account.transfer.requested',
    ts: t,
    data: {
      id: crypto.randomUUID(),
      t,
      accountId: 'acct-1',
      fromVenue: 'binance',
      toVenue: 'hyperliquid',
      asset: 'USDT',
      amount: 1000,
      ...overrides
    }
  };
};

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const makeMetrics = () => createMetrics() as MetricsInstance;

describe('TransferExecutionService', () => {
  it('enqueues transfer + balance adjustments when provider succeeds', async () => {
    const store = makeStore();
    const enqueue = vi.fn();
    const service = new TransferExecutionService({
      enabled: true,
      store,
      enqueue,
      providers: [new MockTransferProvider()],
      logger: createLogger(),
      metrics: makeMetrics(),
      clock: { now: () => 1234567890 }
    });

    service.start();
    const event = createTransferRequestedEvent({ amount: 250 });
    store.stream$.next(event);
    await flushAsync();

    expect(enqueue).toHaveBeenCalledTimes(3);
    const [transferEvent] = enqueue.mock.calls[0];
    expect(transferEvent.type).toBe('account.transfer');
    expect(transferEvent.data).toMatchObject({
      id: (event.data as any).id,
      fromVenue: 'binance',
      toVenue: 'hyperliquid',
      amount: 250
    });
  });

  it('logs when no provider can handle the request', async () => {
    const store = makeStore();
    const logger = createLogger();
    const enqueue = vi.fn();
    const service = new TransferExecutionService({
      enabled: true,
      store,
      enqueue,
      providers: [
        {
          id: 'noop',
          canHandle: () => false,
          execute: vi.fn()
        }
      ],
      logger,
      metrics: makeMetrics(),
      clock: { now: () => Date.now() }
    });
    service.start();
    store.stream$.next(createTransferRequestedEvent());
    await flushAsync();
    expect(enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ component: 'rebalancer' }),
      'No transfer provider available; leaving request pending'
    );
  });

  it('records failures when provider throws', async () => {
    const store = makeStore();
    const enqueue = vi.fn();
    const provider: TransferProvider = {
      id: 'mock-fail',
      canHandle: () => true,
      execute: vi.fn(async () => {
        throw new Error('boom');
      })
    };
    const logger = createLogger();
    const service = new TransferExecutionService({
      enabled: true,
      store,
      enqueue,
      providers: [provider],
      logger,
      metrics: makeMetrics()
    });
    service.start();
    store.stream$.next(createTransferRequestedEvent());
    await flushAsync();
    expect(enqueue).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ component: 'rebalancer', provider: 'mock-fail' }),
      'Automated transfer execution failed'
    );
  });
});
