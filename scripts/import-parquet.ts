import { basename } from 'node:path';
import { loadConfig } from '@rx-trader/config';
import { TimescaleWriter } from '@rx-trader/event-store/timescale';
import { marketTickSchema, type MarketTick } from '@rx-trader/core/domain';
import { safeParse } from '@rx-trader/core/validation';
import { Pool } from 'pg';

const main = async () => {
  const file = process.argv[2];
  if (!file) {
    throw new Error('Usage: bun run scripts/import-parquet.ts <file.parquet>');
  }

  const config = loadConfig();
  const pool = new Pool({ connectionString: config.persistence.pgUrl });
  const writer = new TimescaleWriter(pool);

  console.log(`Importing ${basename(file)} into ${config.persistence.pgUrl}`);

  try {
    const duckdb = await import('duckdb');
    const db = new duckdb.Database(':memory:');
    const connection = db.connect();
    connection.run(`CREATE TABLE tmp AS SELECT * FROM read_parquet('${file}')`);
    const rows = connection.prepare('SELECT * FROM tmp') as unknown as {
      iterate: () => IterableIterator<Record<string, unknown>>;
    };
    for (const row of rows.iterate()) {
      const tick = safeParse(marketTickSchema, row);
      await writer.persistTick(tick as MarketTick);
    }
    connection.close();
    console.log('Import complete');
  } catch (err) {
    console.error('duckdb import failed, ensure duckdb package is installed', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

void main();
