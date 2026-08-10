import { dirname } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { EventStore } from './eventStore';
import { positionsProjection, balancesProjection } from './projections';
import type { BalanceEntry, PositionMark } from '@rx-trader/core/domain';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';

type SnapshotPosition = PositionMark;

export interface PositionsSnapshot {
  ts: number;
  eventCursor?: number;
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
  const committed = await store.readCommitted();
  const events = committed.events;
  const initialPositions = positionsProjection.init();
  const positionsState = events.reduce((state, event) => positionsProjection.reduce(state, event), initialPositions);
  const balancesState = events.reduce(balancesProjection.reduce, balancesProjection.init());
  const captured = clock.now();
  const snapshot: PositionsSnapshot = {
    ts: captured,
    eventCursor: committed.cursor,
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
  const events =
    snapshot.eventCursor === undefined
      ? await store.read(snapshot.ts)
      : (await store.readCommitted(snapshot.eventCursor)).events;
  const positionsState = events.reduce(
    (state, event) => positionsProjection.reduce(state, event),
    { positions: { ...snapshot.positions } as Record<string, PositionMark> }
  );
  const balancesState = events.reduce((state, event) => balancesProjection.reduce(state, event), {
    balances: { ...snapshot.balances }
  });
  return { positions: positionsState.positions, balances: balancesState.balances };
};
