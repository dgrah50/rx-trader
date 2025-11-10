import { describe, expect, it, vi, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import type { OrderNew } from '@rx-trader/core/domain';
import { createExecutionManager } from './executionManager';
import { loadConfig } from '@rx-trader/config';
import { ExecutionVenue } from '@rx-trader/core/constants';
import * as execution from '@rx-trader/execution';
import { createLogger } from '@rx-trader/observability';
import { createTestMetrics } from './testMetrics';

afterEach(() => {
  vi.restoreAllMocks();
});

const createOrder = (): OrderNew => ({
  id: crypto.randomUUID(),
  t: Date.now(),
  symbol: 'BTCUSDT',
  side: 'BUY',
  qty: 1,
  type: 'MKT',
  tif: 'DAY',
  account: 'TEST',
  px: 100
});

describe('createExecutionManager', () => {
  it('uses paper execution in dry-run mode and forwards fills', async () => {
    const enqueue = vi.fn();
    const config = loadConfig();
    const clock = { now: () => 1 };
    const metrics = createTestMetrics();
    const logger = createLogger('test', { enabled: false });
    const manager = createExecutionManager({
      live: false,
      config,
      enqueue,
      clock,
      metrics,
      logger
    });

    expect(manager.adapter).toBeInstanceOf(execution.PaperExecutionAdapter);

    const fills: unknown[] = [];
    manager.fills$.subscribe((fill) => fills.push(fill));

    const order = createOrder();
    await manager.submit(order);

    expect(enqueue).toHaveBeenCalledTimes(2); // ack + fill
    expect(fills).toHaveLength(1);
  });

  it('uses Binance gateway when live=true and credentials are provided', () => {
    const enqueue = vi.fn();
    const config = loadConfig({
      BINANCE_API_KEY: 'key',
      BINANCE_API_SECRET: 'secret'
    });
    const clock = { now: () => 1 };
    const metrics = createTestMetrics();
    const logger = createLogger('test', { enabled: false });

    const fakeAdapter = {
      id: ExecutionVenue.Binance,
      events$: new Subject(),
      submit: vi.fn(),
      cancel: vi.fn()
    };

    const ctorSpy = vi
      .spyOn(execution, 'BinanceRestGateway')
      .mockReturnValue(fakeAdapter as unknown as execution.BinanceRestGateway);

    const manager = createExecutionManager({
      live: true,
      config,
      enqueue,
      clock,
      metrics,
      logger
    });
    expect(ctorSpy).toHaveBeenCalledWith(config.venues?.binance, clock);
    expect(manager.adapter).toBe(fakeAdapter);
  });
});
