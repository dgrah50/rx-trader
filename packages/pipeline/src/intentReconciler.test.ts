import { describe, it, expect, vi, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import type { OrderNew, OrderAck, OrderReject, Fill } from '@rx-trader/core/domain';
import type { ExecutionAdapter } from '@rx-trader/execution';
import { createIntentReconciler } from './intentReconciler';
import { createTestMetrics, getCounterValue, getGaugeValue } from './testMetrics';
import type { Logger } from 'pino';

const makeOrder = (): OrderNew => ({
  id: crypto.randomUUID(),
  t: 0,
  symbol: 'BTCUSDT',
  side: 'BUY',
  qty: 1,
  type: 'MKT',
  tif: 'DAY',
  account: 'TEST'
});

const createLoggerStub = () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn()
  };
  stub.child.mockReturnValue(stub);
  return stub as unknown as Logger;
};

const createAdapter = (): ExecutionAdapter => ({
  id: 'BINANCE',
  events$: new Subject(),
  submit: vi.fn(),
  cancel: vi.fn().mockResolvedValue(undefined)
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const advance = async (ctx: { now: number; poll: number }, delta: number) => {
  ctx.now += delta;
  await sleep(ctx.poll * 3);
};

describe('intent reconciler', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('alerts and cancels orders that never receive an ack', async () => {
    const ctx = { now: 0, poll: 5 };
    const clock = { now: () => ctx.now };
    const order = makeOrder();
    const adapter = createAdapter();
    const ack$ = new Subject<OrderAck>();
    const fills$ = new Subject<Fill>();
    const rejects$ = new Subject<OrderReject>();
    const metrics = createTestMetrics();
    const reconciler = createIntentReconciler({
      config: { ackTimeoutMs: 10, fillTimeoutMs: 40, pollIntervalMs: ctx.poll },
      clock,
      logger: createLoggerStub(),
      metrics,
      adapter,
      ack$,
      fills$,
      rejects$
    });

    reconciler.track(order);
    expect(getGaugeValue(metrics, 'executionPendingIntents', { venue: 'BINANCE' })).toBe(1);
    await advance(ctx, 15);

    expect(adapter.cancel).toHaveBeenCalledWith(order.id);
    expect(
      getCounterValue(metrics, 'executionStaleIntents', {
        venue: 'BINANCE',
        reason: 'ack-timeout'
      })
    ).toBe(1);
    expect(getGaugeValue(metrics, 'executionPendingIntents', { venue: 'BINANCE' })).toBe(1);
    reconciler.stop();
  });

  it('clears intents once fills arrive', async () => {
    const ctx = { now: 0, poll: 5 };
    const clock = { now: () => ctx.now };
    const order = makeOrder();
    const adapter = createAdapter();
    const ack$ = new Subject<OrderAck>();
    const fills$ = new Subject<Fill>();
    const rejects$ = new Subject<OrderReject>();
    const metrics = createTestMetrics();
    const reconciler = createIntentReconciler({
      config: { ackTimeoutMs: 10, fillTimeoutMs: 30, pollIntervalMs: ctx.poll },
      clock,
      logger: createLoggerStub(),
      metrics,
      adapter,
      ack$,
      fills$,
      rejects$
    });

    reconciler.track(order);
    ack$.next({ id: order.id, t: 1, venue: 'BINANCE' });
    fills$.next({
      id: crypto.randomUUID(),
      orderId: order.id,
      t: 2,
      symbol: order.symbol,
      px: 100,
      qty: 1,
      side: order.side
    });

    await advance(ctx, 100);

    expect(adapter.cancel).not.toHaveBeenCalled();
    expect(getGaugeValue(metrics, 'executionPendingIntents', { venue: 'BINANCE' })).toBe(0);
    expect(
      getCounterValue(metrics, 'executionStaleIntents', {
        venue: 'BINANCE',
        reason: 'ack-timeout'
      })
    ).toBe(0);
    reconciler.stop();
  });

  it('alerts when fills never arrive after an ack', async () => {
    const ctx = { now: 0, poll: 5 };
    const clock = { now: () => ctx.now };
    const order = makeOrder();
    const adapter = createAdapter();
    const ack$ = new Subject<OrderAck>();
    const fills$ = new Subject<Fill>();
    const rejects$ = new Subject<OrderReject>();
    const metrics = createTestMetrics();
    const reconciler = createIntentReconciler({
      config: { ackTimeoutMs: 10, fillTimeoutMs: 20, pollIntervalMs: ctx.poll },
      clock,
      logger: createLoggerStub(),
      metrics,
      adapter,
      ack$,
      fills$,
      rejects$
    });

    reconciler.track(order);
    ack$.next({ id: order.id, t: 5, venue: 'BINANCE' });
    await advance(ctx, 25);

    expect(adapter.cancel).toHaveBeenCalledWith(order.id);
    expect(
      getCounterValue(metrics, 'executionStaleIntents', {
        venue: 'BINANCE',
        reason: 'fill-timeout'
      })
    ).toBe(1);
    expect(getGaugeValue(metrics, 'executionPendingIntents', { venue: 'BINANCE' })).toBe(1);
    reconciler.stop();
  });
});
