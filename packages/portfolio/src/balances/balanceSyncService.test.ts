import { describe, expect, it, vi } from 'vitest';
import { BalanceSyncService } from './balanceSyncService';
import type { BalanceProvider } from './types';
import { createManualClock } from '@rx-trader/core/time';

const makeProvider = (
  snapshots: Array<{ asset: string; available: number; locked?: number }>,
  stopSpy = vi.fn()
): BalanceProvider & { stop: ReturnType<typeof vi.fn> } => ({
  venue: 'paper',
  async sync() {
    return snapshots.map((entry) => ({
      venue: 'paper',
      asset: entry.asset,
      available: entry.available,
      locked: entry.locked ?? 0
    }));
  },
  stop: stopSpy
});

describe('BalanceSyncService', () => {
  it('emits adjustments when snapshot differs from projection', async () => {
    const provider = makeProvider([
      { asset: 'USD', available: 1000 },
      { asset: 'BTC', available: 0.5 }
    ]);
    const enqueue = vi.fn();
    const enqueueSnapshot = vi.fn();
    const clock = createManualClock(1_000);
    const recordSuccess = vi.fn();
    const service = new BalanceSyncService({
      accountId: 'ACC',
      provider,
      getBalance: () => undefined,
      enqueue,
      enqueueSnapshot,
      clock,
      intervalMs: 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      instrumentation: { recordSuccess },
      applyLedgerDeltas: true
    });
    await service.start();
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueueSnapshot).toHaveBeenCalledTimes(2);
    const deltas = enqueue.mock.calls.map((call) => (call[0].data as any).delta);
    expect(deltas).toEqual([1000, 0.5]);
    const telemetry = service.getTelemetry();
    expect(telemetry.lastRunMs).not.toBeNull();
    expect(telemetry.lastSuccessMs).toBe(telemetry.lastRunMs);
    expect(telemetry.lastError).toBeNull();
    expect(telemetry.lastDriftBps).not.toBeUndefined();
    expect(recordSuccess).toHaveBeenCalled();
    service.stop();
  });

  it('stops interval and provider when stop is called', async () => {
    const stopSpy = vi.fn();
    const provider = makeProvider([{ asset: 'USD', available: 500 }], stopSpy);
    const enqueue = vi.fn();
    const enqueueSnapshot = vi.fn();
    const clock = createManualClock(1_000);
    const recordFailure = vi.fn();
    const service = new BalanceSyncService({
      accountId: 'ACC',
      provider,
      getBalance: () => ({
        venue: 'paper',
        asset: 'USD',
        available: 500,
        locked: 0,
        total: 500,
        lastUpdated: 0
      }),
      enqueue,
      enqueueSnapshot,
      clock,
      intervalMs: 10,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      instrumentation: { recordFailure }
    });
    await service.start();
    service.stop();
    expect(stopSpy).toHaveBeenCalled();
    expect(service.getTelemetry().venue).toBe('paper');
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('records failures via instrumentation', async () => {
    const provider = {
      venue: 'paper',
      async sync() {
        throw new Error('boom');
      },
      stop: vi.fn()
    } satisfies BalanceProvider;
    const enqueue = vi.fn();
    const enqueueSnapshot = vi.fn();
    const clock = createManualClock(1_000);
    const recordFailure = vi.fn();
    const service = new BalanceSyncService({
      accountId: 'ACC',
      provider,
      getBalance: () => undefined,
      enqueue,
      enqueueSnapshot,
      clock,
      intervalMs: 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      instrumentation: { recordFailure }
    });
    await service.start();
    expect(recordFailure).toHaveBeenCalled();
    expect(service.getTelemetry().lastError).not.toBeNull();
  });

  it('does not repeatedly emit the same snapshot when balances already match', async () => {
    const provider = makeProvider([{ asset: 'USD', available: 1000 }]);
    const enqueue = vi.fn();
    const enqueueSnapshot = vi.fn();
    const clock = createManualClock(1_000);
    let currentTotal = 0;
    const service = new BalanceSyncService({
      accountId: 'ACC',
      provider,
      getBalance: () =>
        currentTotal
          ? {
              venue: 'paper',
              asset: 'USD',
              available: currentTotal,
              locked: 0,
              total: currentTotal,
              lastUpdated: 0
            }
          : undefined,
      enqueue,
      enqueueSnapshot,
      clock,
      intervalMs: 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    await service.syncOnce();
    currentTotal = 1000;
    await service.syncOnce();
    expect(enqueue).toHaveBeenCalledTimes(0);
    expect(enqueueSnapshot).toHaveBeenCalledTimes(2);
  });

  it('records drift snapshots when provider reports older totals without mutating ledger', async () => {
    let providerTotal = 1000;
    const provider = {
      venue: 'paper',
      async sync() {
        return [{ venue: 'paper', asset: 'USD', available: providerTotal, locked: 0 }];
      },
      stop: vi.fn()
    } satisfies BalanceProvider;
    const enqueue = vi.fn();
    const enqueueSnapshot = vi.fn();
    const clock = createManualClock(1_000);
    let ledgerTotal = 0;
    const service = new BalanceSyncService({
      accountId: 'ACC',
      provider,
      getBalance: () =>
        ledgerTotal
          ? { venue: 'paper', asset: 'USD', available: ledgerTotal, locked: 0, total: ledgerTotal, lastUpdated: 0 }
          : undefined,
      enqueue,
      enqueueSnapshot,
      clock,
      intervalMs: 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      applyLedgerDeltas: false
    });
    await service.syncOnce();
    ledgerTotal = 1000;
    providerTotal = 900; // stale snapshot
    await service.syncOnce();
    expect(enqueue).toHaveBeenCalledTimes(0);
    const lastSnapshot = enqueueSnapshot.mock.calls.at(-1)?.[0]?.data as any;
    expect(lastSnapshot.drift).toBe(-100);
    expect(lastSnapshot.ledgerTotal).toBe(1000);
  });
});
