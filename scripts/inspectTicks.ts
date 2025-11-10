import { loadTicks } from '@rx-trader/backtest/loaders';

const file = process.argv[2];
if (!file) {
  console.error('Usage: bun run scripts/inspectTicks.ts <file>');
  process.exit(1);
}

const main = async () => {
  const dataset = await loadTicks(file, { symbol: 'BTCUSDT', limit: 5 });
  console.log(dataset.metadata);
  console.log(dataset.ticks);
};

void main();
