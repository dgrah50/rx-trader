import { sql } from 'drizzle-orm';
import {
  integer,
  sqliteTable,
  text,
  real,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';

export const assetClasses = ['CRYPTO', 'FIAT', 'COMMODITY', 'SPOT', 'PERP'] as const;
export type AssetClass = (typeof assetClasses)[number];

export const contractTypes = ['SPOT', 'PERP', 'FUTURE'] as const;
export type ContractType = (typeof contractTypes)[number];

export const exchangeTable = sqliteTable(
  'exch',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull().default(sql`unixepoch()`),
    updatedAt: integer('updated_at').notNull().default(sql`unixepoch()`)
  }
);
export const currencyTable = sqliteTable(
  'ccy',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    symbol: text('symbol').notNull().unique(),
    assetClass: text('asset_class').notNull().$type<AssetClass>(),
    decimals: integer('decimals').notNull().default(0),
    displayName: text('display_name'),
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull().default(sql`unixepoch()`),
    updatedAt: integer('updated_at').notNull().default(sql`unixepoch()`)
  }
);

export const currencyPairTable = sqliteTable(
  'ccy_pair',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    symbol: text('symbol').notNull().unique(),
    baseCcyId: text('base_ccy_id')
      .notNull()
      .references(() => currencyTable.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    quoteCcyId: text('quote_ccy_id')
      .notNull()
      .references(() => currencyTable.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    assetClass: text('asset_class').notNull().$type<AssetClass>(),
    contractType: text('contract_type').notNull().$type<ContractType>(),
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull().default(sql`unixepoch()`),
    updatedAt: integer('updated_at').notNull().default(sql`unixepoch()`)
  }
);

export const exchangeCurrencyTable = sqliteTable(
  'exch_ccy',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    exchId: text('exch_id')
      .notNull()
      .references(() => exchangeTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    ccyId: text('ccy_id')
      .notNull()
      .references(() => currencyTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    exchSymbol: text('exch_symbol').notNull(),
    status: text('status').notNull().default('trading'),
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull().default(sql`unixepoch()`),
    updatedAt: integer('updated_at').notNull().default(sql`unixepoch()`)
  },
  (table) => ({
    exchangeCurrencyUnique: uniqueIndex('exch_ccy_unique').on(table.exchId, table.exchSymbol)
  })
);

export const exchangePairTable = sqliteTable(
  'exch_ccy_pair',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    exchId: text('exch_id')
      .notNull()
      .references(() => exchangeTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    ccyPairId: text('ccy_pair_id')
      .notNull()
      .references(() => currencyPairTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    exchSymbol: text('exch_symbol').notNull(),
    lotSize: real('lot_size').notNull().default(0),
    minLotSize: real('min_lot_size').notNull().default(0),
    maxLotSize: real('max_lot_size'),
    tickSize: real('tick_size').notNull().default(0),
    pricePrecision: integer('price_precision'),
    quantityPrecision: integer('quantity_precision'),
    quotePrecision: integer('quote_precision'),
    assetClass: text('asset_class').notNull().$type<AssetClass>(),
    contractType: text('contract_type').notNull().$type<ContractType>(),
    status: text('status').notNull().default('trading'),
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull().default(sql`unixepoch()`),
    updatedAt: integer('updated_at').notNull().default(sql`unixepoch()`)
  },
  (table) => ({
    exchangePairUnique: uniqueIndex('exch_ccy_pair_unique').on(table.exchId, table.exchSymbol)
  })
);

export const marketStructureSnapshotTable = sqliteTable('market_structure_snapshot', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  exchId: text('exch_id')
    .notNull()
    .references(() => exchangeTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  payload: text('payload').notNull(),
  snapshotHash: text('snapshot_hash').notNull(),
  fetchedAt: integer('fetched_at').notNull().default(sql`unixepoch()`)
});

export const feeScheduleTable = sqliteTable(
  'fee_schedule',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    exchId: text('exch_id')
      .notNull()
      .references(() => exchangeTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    symbol: text('symbol').notNull(),
    productType: text('product_type').notNull(),
    tier: text('tier').notNull().default('default'),
    makerBps: real('maker_bps').notNull(),
    takerBps: real('taker_bps').notNull(),
    effectiveFrom: integer('effective_from').notNull().default(sql`unixepoch()`),
    effectiveTo: integer('effective_to'),
    source: text('source').notNull().default('manual'),
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull().default(sql`unixepoch()`),
    updatedAt: integer('updated_at').notNull().default(sql`unixepoch()`)
  },
  (table) => ({
    feeScheduleIdx: uniqueIndex('fee_schedule_idx').on(
      table.exchId,
      table.symbol,
      table.productType,
      table.tier,
      table.effectiveFrom
    )
  })
);
export type Exchange = typeof exchangeTable.$inferSelect;
export type Currency = typeof currencyTable.$inferSelect;
export type CurrencyPair = typeof currencyPairTable.$inferSelect;
export type ExchangeCurrency = typeof exchangeCurrencyTable.$inferSelect;
export type ExchangePair = typeof exchangePairTable.$inferSelect;
export type MarketStructureSnapshot = typeof marketStructureSnapshotTable.$inferSelect;
export type FeeSchedule = typeof feeScheduleTable.$inferSelect;
