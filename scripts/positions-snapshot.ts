import { loadConfig } from '@rx-trader/config';
import { createEventStore, savePositionsSnapshot, type PositionsSnapshot } from '@rx-trader/event-store';
import { createScriptClock } from './lib/scriptClock';

const path = process.argv[2] ?? 'snapshots/positions.json';

const main = async () => {
  const config = loadConfig();
  const store = await createEventStore(config);
  const { clock, meta } = createScriptClock('positions_snapshot');
  const snapshot: PositionsSnapshot = await savePositionsSnapshot(store, path, clock, {
    source: meta.source,
    startMs: meta.startMs,
    label: meta.label,
    env: meta.env
  });
  console.log(`Saved snapshot to ${path}`, {
    ts: snapshot.ts,
    positions: snapshot.positions,
    clock: snapshot.clock
  });
};

void main();
