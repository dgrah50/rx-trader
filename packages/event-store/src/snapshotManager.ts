import { dirname } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { EventStore } from './eventStore';
import { positionsProjection, balancesProjection } from './projections';
import type { BalanceEntry } from '@rx-trader/core/domain';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';

type SnapshotPosition = {
  symbol?: string;
  pos?: number;
  avgPx?: number;
  px?: number;
  t?: number;
  realized?: number;
  netRealized?: number;
  grossRealized?: number;
  unrealized?: number;
  notional?: number;
  pnl?: number;
};

export interface PositionsSnapshot {
  ts: number;
  positions: Record<string, SnapshotPosition>;
  balances?: Record<string, Record<string, BalanceEntry>>;
  clock?: SnapshotClockMetadata;
}

interface SnapshotClockMetadata {
  source: string;
  startMs: number;
  capturedMs: number;
  label?: string;
  env?: string;
}

interface SnapshotClockMetaInput {
  source?: string;
  startMs?: number;
  label?: string;
  env?: string;
}

const ensureDir = (path: string) => {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
};

export const savePositionsSnapshot = async (
  store: EventStore,
  path: string,
  clock: Clock = systemClock,
  clockMeta?: SnapshotClockMetaInput
) => {
  const events = await store.read();
  const positionsState = events.reduce(positionsProjection.reduce, positionsProjection.init());
  const balancesState = events.reduce(balancesProjection.reduce, balancesProjection.init());
  const captured = clock.now();
  const snapshot: PositionsSnapshot = {
    ts: captured,
    positions: positionsState.positions,
    balances: balancesState.balances,
    clock: {
      source: clockMeta?.source ?? 'system',
      startMs: clockMeta?.startMs ?? captured,
      capturedMs: captured,
      label: clockMeta?.label,
      env: clockMeta?.env
    }
  };
  ensureDir(path);
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf8');
  return snapshot;
};

export const loadPositionsSnapshot = (path: string): PositionsSnapshot => {
  return JSON.parse(readFileSync(path, 'utf8')) as PositionsSnapshot;
};

export const replayPositionsFromSnapshot = async (
  store: EventStore,
  snapshot: PositionsSnapshot
) => {
  const events = await store.read(snapshot.ts);
  const positionsState = events.reduce(
    positionsProjection.reduce,
    { positions: { ...snapshot.positions } }
  );
  const balancesState = events.reduce(
    balancesProjection.reduce,
    { balances: { ...snapshot.balances } }
  );
  return { positions: positionsState.positions, balances: balancesState.balances };
};
