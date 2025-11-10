import { loadConfig } from '@rx-trader/config';
import { createEventStore } from '@rx-trader/event-store';
import { marketTickSchema } from '@rx-trader/core/domain';
import { safeParse } from '@rx-trader/core/validation';

const main = async () => {
  const config = loadConfig();
  const store = await createEventStore(config);
  await store.append({
    id: crypto.randomUUID(),
    type: 'market.tick',
    data: safeParse(marketTickSchema, {
      t: Date.now(),
      symbol: 'SIM',
      bid: 100,
      ask: 100.1
    }),
    ts: Date.now(),
    metadata: { source: 'seed-script', env: config.app.env }
  });
  console.log('Seeded demo tick event');
};

void main();
