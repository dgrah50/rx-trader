import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import type { OrderNew } from '@rx-trader/core/domain';
import type { ExecutionAdapter } from '@rx-trader/execution';
import { createExecutionPolicy, ExecutionCircuitOpenError } from './executionPolicy';
import { createTestMetrics, getCounterValue, getGaugeValue } from './testMetrics';
import type { Logger } from 'pino';

const order: OrderNew = {
  id: crypto.randomUUID(),
  t: 0,
  symbol: 'BTCUSDT',
  side: 'BUY',
  qty: 1,
  type: 'MKT',
  tif: 'DAY',
  account: 'TEST'
};

const createAdapter = (submitImpl: () => Promise<void>): ExecutionAdapter => ({
  id: 'BINANCE',
  events$: new Subject(),
  submit: submitImpl,
  cancel: vi.fn()
});

const loggerStub = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn()
};
loggerStub.child.mockReturnValue(loggerStub);
const logger = loggerStub as unknown as Logger;

let clockNow = 0;
const clock = { now: () => clockNow };

beforeEach(() => {
  clockNow = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createExecutionPolicy', () => {
  it('retries and succeeds on a subsequent attempt', async () => {
    const submit = vi
      .fn<[], Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const adapter = createAdapter(submit);
    const metrics = createTestMetrics();
    const policy = createExecutionPolicy({
      adapter,
      config: {
        retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: 0 },
        circuitBreaker: { failureThreshold: 3, cooldownMs: 10, halfOpenMaxSuccesses: 1 }
      },
      metrics,
      logger,
      clock
    });

    await policy.submit(order);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(getCounterValue(metrics, 'executionRetries', { venue: 'BINANCE' })).toBe(1);
    expect(getGaugeValue(metrics, 'executionCircuitState', { venue: 'BINANCE' })).toBe(0);
  });

  it('opens the circuit after repeated failures', async () => {
    const submit = vi.fn<[], Promise<void>>().mockRejectedValue(new Error('down'));
    const adapter = createAdapter(submit);
    const metrics = createTestMetrics();
    const policy = createExecutionPolicy({
      adapter,
      config: {
        retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, jitter: 0 },
        circuitBreaker: { failureThreshold: 2, cooldownMs: 100, halfOpenMaxSuccesses: 1 }
      },
      metrics,
      logger,
      clock
    });

    await expect(policy.submit(order)).rejects.toThrow('down');
    await expect(policy.submit(order)).rejects.toThrow('down');
    await expect(policy.submit(order)).rejects.toBeInstanceOf(ExecutionCircuitOpenError);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(getCounterValue(metrics, 'executionCircuitTrips', { venue: 'BINANCE' })).toBe(1);
    expect(
      getCounterValue(metrics, 'executionFailures', { venue: 'BINANCE', reason: 'down' })
    ).toBe(2);
    expect(getGaugeValue(metrics, 'executionCircuitState', { venue: 'BINANCE' })).toBe(1);
  });

  it('closes the circuit after cooldown and successful half-open attempts', async () => {
    const submit = vi
      .fn<[], Promise<void>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(undefined);
    const adapter = createAdapter(submit);
    const metrics = createTestMetrics();
    const policy = createExecutionPolicy({
      adapter,
      config: {
        retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, jitter: 0 },
        circuitBreaker: { failureThreshold: 1, cooldownMs: 10, halfOpenMaxSuccesses: 1 }
      },
      metrics,
      logger,
      clock
    });

    await expect(policy.submit(order)).rejects.toThrow('down');
    clockNow += 11;
    await expect(policy.submit(order)).resolves.toBeUndefined();
    expect(getGaugeValue(metrics, 'executionCircuitState', { venue: 'BINANCE' })).toBe(0);
  });
});
