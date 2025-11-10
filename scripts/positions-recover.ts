import { loadConfig } from '@rx-trader/config';
import {
  createEventStore,
  loadPositionsSnapshot,
  replayPositionsFromSnapshot,
  type PositionsSnapshot
} from '@rx-trader/event-store';

const path = process.argv[2] ?? 'snapshots/positions.json';

const main = async () => {
  const config = loadConfig();
  const store = await createEventStore(config);
  const snapshot: PositionsSnapshot = loadPositionsSnapshot(path);
  const state = await replayPositionsFromSnapshot(store, snapshot);
  console.log('Recovered positions state', state.positions);
};

void main();
