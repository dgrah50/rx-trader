import { loadConfig } from '@rx-trader/config';
import { buildProjection, ordersView, createEventStore } from '@rx-trader/event-store';

const main = async () => {
  const config = loadConfig();
  const store = await createEventStore(config);
  const projection = await buildProjection(store, ordersView);
  console.log('Rebuilt projection', projection);
};

void main();
