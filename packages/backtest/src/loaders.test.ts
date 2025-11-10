import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadTicks } from './loaders';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const fixture = (name: string) =>
  resolve(__dirname, '__fixtures__', name);

const sampleTicks = [
  { t: 1, symbol: 'SIM', bid: 100, ask: 100.1, last: 100.05 },
  { t: 2, symbol: 'SIM', bid: 101, ask: 101.1, last: 101.05 }
];

describe('loadTicks', () => {
  it('loads JSON datasets with metadata and respects limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rx-json-'));
    const file = join(dir, 'ticks.json');
    writeFileSync(file, JSON.stringify(sampleTicks));
    const dataset = await loadTicks(file, { symbol: 'SIM', limit: 1 });
    expect(dataset.ticks).toHaveLength(1);
    expect(dataset.metadata.format).toBe('json');
    expect(dataset.metadata.count).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads CSV datasets via DuckDB', async () => {
    const dataset = await loadTicks(fixture('ticks.csv'), { symbol: 'BTCUSDT' });
    expect(dataset.ticks).toHaveLength(2);
    expect(dataset.metadata.format).toBe('csv');
    expect(dataset.metadata.symbols.BTCUSDT).toBe(2);
  });

  it('loads Parquet datasets via DuckDB', async () => {
    const dataset = await loadTicks(fixture('ticks.parquet'), { symbol: 'ETHUSDT' });
    expect(dataset.ticks).toHaveLength(1);
    expect(dataset.ticks[0].symbol).toBe('ETHUSDT');
    expect(dataset.metadata.format).toBe('parquet');
  });
});
