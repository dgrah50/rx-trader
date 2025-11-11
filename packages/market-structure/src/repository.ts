import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import {
  currencyPairTable,
  currencyTable,
  exchangeCurrencyTable,
  exchangePairTable,
  exchangeTable,
  feeScheduleTable,
  marketStructureSnapshotTable,
  type AssetClass,
  type ContractType
} from './schema';
import type { MarketStructureDatabase } from './db';
import type { ExchangePair, Exchange, CurrencyPair } from './schema';
import type { ExchangePairRecord, FeeScheduleUpsert } from './types';

type ExchangePairRow = {
  exch_ccy_pair: ExchangePair;
  exch: Exchange;
  ccy_pair: CurrencyPair;
};

export interface ExchangeUpsert {
  code: string;
  name: string;
}

export interface CurrencyUpsert {
  symbol: string;
  assetClass: AssetClass;
  decimals?: number;
  displayName?: string;
  metadata?: string | null;
}

export interface CurrencyPairUpsert {
  symbol: string;
  baseSymbol: string;
  quoteSymbol: string;
  assetClass: AssetClass;
  contractType: ContractType;
  metadata?: string | null;
}

export interface ExchangeCurrencyUpsert {
  exchangeCode: string;
  currencySymbol: string;
  exchSymbol: string;
  status?: string;
  metadata?: string | null;
}

export interface ExchangePairUpsert {
  exchangeCode: string;
  pairSymbol: string;
  exchSymbol: string;
  lotSize: number;
  minLotSize: number;
  maxLotSize?: number | null;
  tickSize: number;
  pricePrecision?: number | null;
  quantityPrecision?: number | null;
  quotePrecision?: number | null;
  assetClass: AssetClass;
  contractType: ContractType;
  status?: string;
  metadata?: string | null;
}

export class MarketStructureRepository {
  constructor(private readonly db: MarketStructureDatabase) {}

  async ensureExchange(data: ExchangeUpsert) {
    await this.db
      .insert(exchangeTable)
      .values({ code: data.code, name: data.name })
      .onConflictDoUpdate({ target: exchangeTable.code, set: { name: data.name } });
  }

  async upsertCurrency(entry: CurrencyUpsert) {
    await this.db
      .insert(currencyTable)
      .values({
        symbol: entry.symbol,
        assetClass: entry.assetClass,
        decimals: entry.decimals ?? 0,
        displayName: entry.displayName,
        metadata: entry.metadata ?? null
      })
      .onConflictDoUpdate({
        target: currencyTable.symbol,
        set: {
          assetClass: entry.assetClass,
          decimals: entry.decimals ?? 0,
          displayName: entry.displayName,
          metadata: entry.metadata ?? null
        }
      });
  }

  async upsertCurrencies(entries: CurrencyUpsert[]) {
    for (const entry of entries) {
      await this.upsertCurrency(entry);
    }
  }

  async upsertPair(entry: CurrencyPairUpsert) {
    const base = await this.getOrCreateCurrency(entry.baseSymbol, entry.assetClass);
    const quote = await this.getOrCreateCurrency(entry.quoteSymbol, entry.assetClass);
    await this.db
      .insert(currencyPairTable)
      .values({
        symbol: entry.symbol,
        baseCcyId: base,
        quoteCcyId: quote,
        assetClass: entry.assetClass,
        contractType: entry.contractType,
        metadata: entry.metadata ?? null
      })
      .onConflictDoUpdate({
        target: currencyPairTable.symbol,
        set: {
          baseCcyId: base,
          quoteCcyId: quote,
          assetClass: entry.assetClass,
          contractType: entry.contractType,
          metadata: entry.metadata ?? null
        }
      });
  }

  private async getOrCreateCurrency(symbol: string, assetClass: AssetClass) {
    const existing = await this.db
      .select({ id: currencyTable.id })
      .from(currencyTable)
      .where(eq(currencyTable.symbol, symbol))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const [created] = await this.db
      .insert(currencyTable)
      .values({ symbol, assetClass })
      .returning({ id: currencyTable.id });
    return created.id;
  }

  async upsertExchangeCurrency(entry: ExchangeCurrencyUpsert) {
    const exchangeId = await this.getExchangeId(entry.exchangeCode);
    const currencyId = await this.getCurrencyId(entry.currencySymbol);
    await this.db
      .insert(exchangeCurrencyTable)
      .values({
        exchId: exchangeId,
        ccyId: currencyId,
        exchSymbol: entry.exchSymbol,
        status: entry.status ?? 'trading',
        metadata: entry.metadata ?? null
      })
      .onConflictDoUpdate({
        target: [exchangeCurrencyTable.exchId, exchangeCurrencyTable.exchSymbol],
        set: {
          ccyId: currencyId,
          status: entry.status ?? 'trading',
          metadata: entry.metadata ?? null
        }
      });
  }

  async upsertExchangeCurrencies(entries: ExchangeCurrencyUpsert[]) {
    for (const entry of entries) {
      await this.upsertExchangeCurrency(entry);
    }
  }

  async upsertExchangePair(entry: ExchangePairUpsert) {
    const exchangeId = await this.getExchangeId(entry.exchangeCode);
    const pairId = await this.getPairId(entry.pairSymbol);
    await this.db
      .insert(exchangePairTable)
      .values({
        exchId: exchangeId,
        ccyPairId: pairId,
        exchSymbol: entry.exchSymbol,
        lotSize: entry.lotSize,
        minLotSize: entry.minLotSize,
        maxLotSize: entry.maxLotSize ?? null,
        tickSize: entry.tickSize,
        pricePrecision: entry.pricePrecision ?? null,
        quantityPrecision: entry.quantityPrecision ?? null,
        quotePrecision: entry.quotePrecision ?? null,
        assetClass: entry.assetClass,
        contractType: entry.contractType,
        status: entry.status ?? 'trading',
        metadata: entry.metadata ?? null
      })
      .onConflictDoUpdate({
        target: [exchangePairTable.exchId, exchangePairTable.exchSymbol],
        set: {
          ccyPairId: pairId,
          lotSize: entry.lotSize,
          minLotSize: entry.minLotSize,
          maxLotSize: entry.maxLotSize ?? null,
          tickSize: entry.tickSize,
          pricePrecision: entry.pricePrecision ?? null,
          quantityPrecision: entry.quantityPrecision ?? null,
          quotePrecision: entry.quotePrecision ?? null,
          assetClass: entry.assetClass,
          contractType: entry.contractType,
          status: entry.status ?? 'trading',
          metadata: entry.metadata ?? null
        }
      });
  }

  async upsertExchangePairs(entries: ExchangePairUpsert[]) {
    for (const entry of entries) {
      await this.upsertExchangePair(entry);
    }
  }

  async getExchangePair(exchangeCode: string, exchSymbol: string): Promise<ExchangePairRecord | null> {
    const result = await this.db
      .select()
      .from(exchangePairTable)
      .innerJoin(exchangeTable, eq(exchangePairTable.exchId, exchangeTable.id))
      .innerJoin(currencyPairTable, eq(exchangePairTable.ccyPairId, currencyPairTable.id))
      .where(
        and(eq(exchangeTable.code, exchangeCode), eq(exchangePairTable.exchSymbol, exchSymbol))
      )
      .limit(1);
    const row = result[0] as ExchangePairRow | undefined;
    if (!row) return null;
    return {
      exchangePair: row.exch_ccy_pair,
      exchange: row.exch,
      pair: row.ccy_pair
    };
  }

  async recordSnapshot(exchangeCode: string, payload: string, hash: string) {
    const exchangeId = await this.getExchangeId(exchangeCode);
    await this.db.insert(marketStructureSnapshotTable).values({
      exchId: exchangeId,
      payload,
      snapshotHash: hash
    });
  }

  async upsertFeeSchedules(entries: FeeScheduleUpsert[]) {
    for (const entry of entries) {
      await this.upsertFeeSchedule(entry);
    }
  }

  async upsertFeeSchedule(entry: FeeScheduleUpsert) {
    const exchangeId = await this.getExchangeId(entry.exchangeCode);
    await this.db
      .insert(feeScheduleTable)
      .values({
        exchId: exchangeId,
        symbol: entry.symbol.toUpperCase(),
        productType: entry.productType,
        tier: entry.tier ?? 'default',
        makerBps: entry.makerBps,
        takerBps: entry.takerBps,
        effectiveFrom: entry.effectiveFrom,
        effectiveTo: entry.effectiveTo ?? null,
        source: entry.source ?? 'manual',
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null
      })
      .onConflictDoUpdate({
        target: [
          feeScheduleTable.exchId,
          feeScheduleTable.symbol,
          feeScheduleTable.productType,
          feeScheduleTable.tier,
          feeScheduleTable.effectiveFrom
        ],
        set: {
          makerBps: entry.makerBps,
          takerBps: entry.takerBps,
          effectiveTo: entry.effectiveTo ?? null,
          source: entry.source ?? 'manual',
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
          updatedAt: Math.floor(Date.now() / 1000)
        }
      });
  }

  async getFeeSchedule(
    exchangeCode: string,
    symbol: string,
    productType: string,
    asOfMs: number = Date.now()
  ) {
    const exchangeId = await this.getExchangeId(exchangeCode);
    const asOf = Math.floor(asOfMs / 1000);
    const rows = await this.db
      .select()
      .from(feeScheduleTable)
      .where(
        and(
          eq(feeScheduleTable.exchId, exchangeId),
          eq(feeScheduleTable.symbol, symbol.toUpperCase()),
          eq(feeScheduleTable.productType, productType),
          lte(feeScheduleTable.effectiveFrom, asOf),
          or(isNull(feeScheduleTable.effectiveTo), gte(feeScheduleTable.effectiveTo, asOf))
        )
      )
      .orderBy(desc(feeScheduleTable.effectiveFrom))
      .limit(1);
    if (rows[0]) {
      return rows[0];
    }
    const wildcard = await this.db
      .select()
      .from(feeScheduleTable)
      .where(
        and(
          eq(feeScheduleTable.exchId, exchangeId),
          eq(feeScheduleTable.symbol, '*'),
          eq(feeScheduleTable.productType, productType),
          lte(feeScheduleTable.effectiveFrom, asOf),
          or(isNull(feeScheduleTable.effectiveTo), gte(feeScheduleTable.effectiveTo, asOf))
        )
      )
      .orderBy(desc(feeScheduleTable.effectiveFrom))
      .limit(1);
    return wildcard[0] ?? null;
  }

  private async getExchangeId(code: string) {
    const [record] = await this.db
      .select({ id: exchangeTable.id })
      .from(exchangeTable)
      .where(eq(exchangeTable.code, code))
      .limit(1);
    if (!record) {
      throw new Error(`Unknown exchange ${code}`);
    }
    return record.id;
  }

  private async getCurrencyId(symbol: string) {
    const [record] = await this.db
      .select({ id: currencyTable.id })
      .from(currencyTable)
      .where(eq(currencyTable.symbol, symbol))
      .limit(1);
    if (!record) {
      throw new Error(`Unknown currency ${symbol}`);
    }
    return record.id;
  }

  private async getPairId(symbol: string) {
    const [record] = await this.db
      .select({ id: currencyPairTable.id })
      .from(currencyPairTable)
      .where(eq(currencyPairTable.symbol, symbol))
      .limit(1);
    if (!record) {
      throw new Error(`Unknown pair ${symbol}`);
    }
    return record.id;
  }
}
