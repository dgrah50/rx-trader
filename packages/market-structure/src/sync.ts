import { createHash } from 'node:crypto';
import type { MarketStructureRepository } from './repository';
import type {
  MarketStructureSnapshotData,
  VenueCurrency,
  VenueExchangeCurrency,
  VenueExchangePair,
  VenuePair
} from './types';

export interface SyncMarketStructureOptions {
  repository: MarketStructureRepository;
  snapshot: MarketStructureSnapshotData;
}

const toMetadata = (value?: Record<string, unknown> | null) =>
  value ? JSON.stringify(value) : null;

const normalizeCurrency = (entry: VenueCurrency) => ({
  symbol: entry.symbol,
  assetClass: entry.assetClass,
  decimals: entry.decimals,
  displayName: entry.displayName,
  metadata: toMetadata(entry.metadata ?? null)
});

const normalizePair = (entry: VenuePair) => ({
  symbol: entry.symbol,
  baseSymbol: entry.baseSymbol,
  quoteSymbol: entry.quoteSymbol,
  assetClass: entry.assetClass,
  contractType: entry.contractType,
  metadata: toMetadata(entry.metadata ?? null)
});

const normalizeExchangeCurrency = (entry: VenueExchangeCurrency) => ({
  exchangeCode: entry.exchangeCode,
  currencySymbol: entry.currencySymbol,
  exchSymbol: entry.exchSymbol,
  status: entry.status,
  metadata: toMetadata(entry.metadata ?? null)
});

const normalizeExchangePair = (entry: VenueExchangePair) => ({
  ...entry,
  metadata: toMetadata(entry.metadata ?? null)
});

export const syncMarketStructure = async ({ repository, snapshot }: SyncMarketStructureOptions) => {
  await repository.ensureExchange(snapshot.exchange);
  await repository.upsertCurrencies(snapshot.currencies.map(normalizeCurrency));
  for (const pair of snapshot.pairs.map(normalizePair)) {
    await repository.upsertPair(pair);
  }
  await repository.upsertExchangeCurrencies(snapshot.exchangeCurrencies.map(normalizeExchangeCurrency));
  await repository.upsertExchangePairs(snapshot.exchangePairs.map(normalizeExchangePair));

  const payload = JSON.stringify(snapshot.raw ?? snapshot);
  const hash = createHash('sha256').update(payload).digest('hex');
  await repository.recordSnapshot(snapshot.exchange.code, payload, hash);
};
