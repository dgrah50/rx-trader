import type { Clock } from '@rx-trader/core/time';
import type {
  accountBalanceAdjustedSchema,
  accountBalanceSnapshotSchema,
  BalanceEntry,
  BalanceSyncTelemetry as CoreBalanceSyncTelemetry
} from '@rx-trader/core/domain';
import type { z } from 'zod';

export type AccountBalanceAdjustedEventData = z.infer<typeof accountBalanceAdjustedSchema>;
export type AccountBalanceSnapshotEventData = z.infer<typeof accountBalanceSnapshotSchema>;

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
    data: AccountBalanceAdjustedEventData | AccountBalanceSnapshotEventData;
    ts: number;
  }) => void;
  enqueueSnapshot?: (event: {
    id: string;
    type: 'account.balance.snapshot';
    data: AccountBalanceSnapshotEventData;
    ts: number;
  }) => void;
  clock: Clock;
  intervalMs?: number;
  logger?: { info: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void };
  driftBpsThreshold?: number;
  instrumentation?: BalanceSyncInstrumentation;
  applyLedgerDeltas?: boolean;
}

export interface BalanceSyncTelemetry extends CoreBalanceSyncTelemetry {
  lastDriftBps?: number | null;
}

interface BalanceSyncInstrumentation {
  recordSuccess?: (payload: { venue: string; timestampMs: number; driftBps: number | null }) => void;
  recordFailure?: (payload: { venue: string; error: unknown }) => void;
}
