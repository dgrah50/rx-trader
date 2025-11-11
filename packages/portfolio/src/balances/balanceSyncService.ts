import {
  accountBalanceAdjustedSchema,
  accountBalanceSnapshotSchema
} from '@rx-trader/core/domain';
import { safeParse } from '@rx-trader/core/validation';
import type {
  BalanceProvider,
  BalanceSnapshot,
  BalanceSyncOptions,
  BalanceSyncTelemetry
} from './types';

const EPSILON = 1e-9;

export class BalanceSyncService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRun: number | null = null;
  private lastSuccess: number | null = null;
  private lastError: { message: string; ts: number } | null = null;
  private lastDriftBps: number | null = null;
  private readonly totalsCache = new Map<string, number>();
  constructor(private readonly options: BalanceSyncOptions) {}

  async start() {
    await this.syncOnce();
    const interval = this.options.intervalMs ?? 60_000;
    if (interval > 0) {
      this.timer = setInterval(() => {
        void this.syncOnce();
      }, interval);
    }
  }

  async syncOnce() {
    if (this.running) return;
    this.running = true;
    this.lastRun = this.options.clock.now();
    try {
      const snapshots = await this.options.provider.sync();
      await Promise.all(snapshots.map((snapshot) => this.reconcileSnapshot(snapshot)));
      this.lastSuccess = this.lastRun;
      this.lastError = null;
      this.options.instrumentation?.recordSuccess?.({
        venue: this.options.provider.venue,
        timestampMs: this.lastSuccess ?? this.options.clock.now(),
        driftBps: this.lastDriftBps
      });
    } catch (error) {
      this.options.logger?.warn({ err: error instanceof Error ? error.message : error }, 'Balance sync failed');
      this.lastError = {
        message: error instanceof Error ? error.message : String(error),
        ts: this.lastRun ?? this.options.clock.now()
      };
      this.options.instrumentation?.recordFailure?.({
        venue: this.options.provider.venue,
        error
      });
    } finally {
      this.running = false;
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.options.provider.stop?.();
  }

  getTelemetry(): BalanceSyncTelemetry {
    const providerKind = this.options.provider.constructor?.name ?? 'Provider';
    const providerLabel = `${providerKind.replace(/Provider$/, '').toLowerCase()}(${this.options.provider.venue})`;
    return {
      venue: this.options.provider.venue,
      provider: providerLabel,
      lastRunMs: this.lastRun,
      lastSuccessMs: this.lastSuccess,
      lastError: this.lastError,
      lastDriftBps: this.lastDriftBps
    };
  }

  private async reconcileSnapshot(snapshot: BalanceSnapshot) {
    const current = this.options.getBalance(snapshot.venue, snapshot.asset);
    const key = `${snapshot.venue}:${snapshot.asset}`;
    const cachedTotal = this.totalsCache.get(key);
    const currentTotal = cachedTotal ?? current?.total ?? 0;
    const targetTotal = snapshot.available + snapshot.locked;
    const delta = targetTotal - currentTotal;
    if (Math.abs(delta) < EPSILON) {
      this.recordSnapshot(snapshot, currentTotal, delta, targetTotal);
      return;
    }
    const driftBps = targetTotal === 0 ? null : (delta / targetTotal) * 10_000;
    this.lastDriftBps = driftBps ?? 0;
    const threshold = this.options.driftBpsThreshold ?? 500;
    const trackDrift = Number.isFinite(threshold);
    if (trackDrift && driftBps !== null && Math.abs(driftBps) > threshold) {
      this.options.logger?.warn(
        {
          venue: snapshot.venue,
          asset: snapshot.asset,
          driftBps,
          delta,
          targetTotal
        },
        'Detected balance drift exceeding threshold'
      );
    }
    const ts = this.options.clock.now();
    if (this.options.applyLedgerDeltas) {
      const payload = safeParse(
        accountBalanceAdjustedSchema,
        {
          id: crypto.randomUUID(),
          t: ts,
          accountId: this.options.accountId,
          venue: snapshot.venue,
          asset: snapshot.asset,
          delta,
          newTotal: targetTotal,
          reason: 'sync',
          metadata: {
            provider: this.options.provider.venue,
            available: snapshot.available,
            locked: snapshot.locked
          }
        },
        { force: true }
      );
      this.options.enqueue({
        id: crypto.randomUUID(),
        type: 'account.balance.adjusted',
        data: payload,
        ts
      });
      this.totalsCache.set(key, targetTotal);
    }
    this.recordSnapshot(snapshot, currentTotal, delta, targetTotal);
  }

  private recordSnapshot(
    snapshot: BalanceSnapshot,
    ledgerTotal: number,
    delta: number,
    total: number
  ) {
    const payload = safeParse(
      accountBalanceSnapshotSchema,
      {
        id: crypto.randomUUID(),
        t: this.options.clock.now(),
        accountId: this.options.accountId,
        venue: snapshot.venue,
        asset: snapshot.asset,
        total,
        provider: this.options.provider.venue,
        ledgerTotal,
        drift: delta,
        metadata: {
          available: snapshot.available,
          locked: snapshot.locked
        }
      },
      { force: true }
    );
    const enqueueSnapshot = this.options.enqueueSnapshot ?? this.options.enqueue;
    enqueueSnapshot({
      id: crypto.randomUUID(),
      type: 'account.balance.snapshot',
      data: payload,
      ts: payload.t
    });
  }
}
