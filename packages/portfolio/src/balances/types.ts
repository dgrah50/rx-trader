import type { Clock } from '@rx-trader/core/time';
import type { BalanceEntry } from '@rx-trader/core/domain';

export interface BalanceSnapshot {
  venue: string;
  asset: string;
  available: number;
  locked: number;
}

export interface BalanceProvider {
  readonly venue: string;
  sync(): Promise<BalanceSnapshot[]>;
  stop?(): void;
}

export interface BalanceSyncOptions {
  accountId: string;
  provider: BalanceProvider;
  getBalance: (venue: string, asset: string) => BalanceEntry | undefined;
  enqueue: (event: {
    id: string;
    type: 'account.balance.adjusted' | 'account.balance.snapshot';
    data: unknown;
    ts: number;
  }) => void;
  enqueueSnapshot?: (event: {
    id: string;
    type: 'account.balance.snapshot';
    data: unknown;
    ts: number;
  }) => void;
  clock: Clock;
  intervalMs?: number;
  logger?: { info: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void };
  driftBpsThreshold?: number;
  instrumentation?: BalanceSyncInstrumentation;
  applyLedgerDeltas?: boolean;
}

export interface BalanceSyncTelemetry {
  venue: string;
  provider: string;
  lastRunMs: number | null;
  lastSuccessMs: number | null;
  lastError?: { message: string; ts: number } | null;
  lastDriftBps?: number | null;
}

interface BalanceSyncInstrumentation {
  recordSuccess?: (payload: { venue: string; timestampMs: number; driftBps: number | null }) => void;
  recordFailure?: (payload: { venue: string; error: unknown }) => void;
}
