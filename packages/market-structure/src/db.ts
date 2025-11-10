import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

export type MarketStructureDatabase = ReturnType<typeof drizzle<typeof schema>>;

export interface MarketStructureStore {
  db: MarketStructureDatabase;
  close: () => void;
}

const ensureTables = (database: Database) => {
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS exch (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS ccy (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL UNIQUE,
      asset_class TEXT NOT NULL,
      decimals INTEGER NOT NULL DEFAULT 0,
      display_name TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS ccy_pair (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL UNIQUE,
      base_ccy_id TEXT NOT NULL,
      quote_ccy_id TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      contract_type TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (base_ccy_id) REFERENCES ccy(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (quote_ccy_id) REFERENCES ccy(id) ON UPDATE CASCADE ON DELETE RESTRICT
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS exch_ccy (
      id TEXT PRIMARY KEY,
      exch_id TEXT NOT NULL,
      ccy_id TEXT NOT NULL,
      exch_symbol TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'trading',
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (exch_id) REFERENCES exch(id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (ccy_id) REFERENCES ccy(id) ON UPDATE CASCADE ON DELETE CASCADE,
      UNIQUE (exch_id, exch_symbol)
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS exch_ccy_pair (
      id TEXT PRIMARY KEY,
      exch_id TEXT NOT NULL,
      ccy_pair_id TEXT NOT NULL,
      exch_symbol TEXT NOT NULL,
      lot_size REAL NOT NULL DEFAULT 0,
      min_lot_size REAL NOT NULL DEFAULT 0,
      max_lot_size REAL,
      tick_size REAL NOT NULL DEFAULT 0,
      price_precision INTEGER,
      quantity_precision INTEGER,
      quote_precision INTEGER,
      asset_class TEXT NOT NULL,
      contract_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'trading',
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (exch_id) REFERENCES exch(id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (ccy_pair_id) REFERENCES ccy_pair(id) ON UPDATE CASCADE ON DELETE CASCADE,
      UNIQUE (exch_id, exch_symbol)
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS market_structure_snapshot (
      id TEXT PRIMARY KEY,
      exch_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (exch_id) REFERENCES exch(id) ON UPDATE CASCADE ON DELETE CASCADE
    );
  `);
};

export const createMarketStructureStore = (sqlitePath: string): MarketStructureStore => {
  const database = new Database(sqlitePath, { create: true });
  ensureTables(database);
  const db = drizzle(database, { schema });
  return {
    db,
    close: () => database.close()
  };
};
