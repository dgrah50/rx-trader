import { accountBalanceAdjustedSchema } from '@rx-trader/core/domain';
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
    return {
      venue: this.options.provider.venue,
      provider: this.options.provider.venue,
      lastRunMs: this.lastRun,
      lastSuccessMs: this.lastSuccess,
      lastError: this.lastError,
      lastDriftBps: this.lastDriftBps
    };
  }

  private async reconcileSnapshot(snapshot: BalanceSnapshot) {
    const current = this.options.getBalance(snapshot.venue, snapshot.asset);
    const currentTotal = current?.total ?? 0;
    const targetTotal = snapshot.available + snapshot.locked;
    const delta = targetTotal - currentTotal;
    if (Math.abs(delta) < EPSILON) {
      return;
    }
    const driftBps = targetTotal === 0 ? null : (delta / targetTotal) * 10_000;
    this.lastDriftBps = driftBps ?? 0;
    const threshold = this.options.driftBpsThreshold ?? 500;
    if (driftBps !== null && Math.abs(driftBps) > threshold) {
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
    const payload = safeParse(
      accountBalanceAdjustedSchema,
      {
        id: crypto.randomUUID(),
        t: ts,
        accountId: this.options.accountId,
        venue: snapshot.venue,
        asset: snapshot.asset,
        delta,
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
  }
}
