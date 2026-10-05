import { parseFiniteNumber } from '@rx-trader/core';
import type { MarketStructureSnapshotData, VenueExchangePair } from '../types';

interface BinanceExchangeInfo {
  symbols: Array<{
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    baseAssetPrecision: number;
    quotePrecision: number;
    pricePrecision?: number;
    quantityPrecision?: number;
    status: string;
    filters: Array<{ filterType: string; tickSize?: string; stepSize?: string; minQty?: string; maxQty?: string }>;
    permissions?: string[];
  }>;
}

type BinanceSymbol = BinanceExchangeInfo['symbols'][number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isOptionalNumber = (value: unknown): value is number | undefined =>
  value === undefined || typeof value === 'number';

const isBinanceFilter = (value: unknown): value is BinanceSymbol['filters'][number] =>
  isRecord(value) &&
  typeof value.filterType === 'string' &&
  ['tickSize', 'stepSize', 'minQty', 'maxQty'].every(
    (key) => value[key] === undefined || typeof value[key] === 'string'
  );

const isBinanceSymbol = (value: unknown): value is BinanceSymbol =>
  isRecord(value) &&
  typeof value.symbol === 'string' &&
  typeof value.baseAsset === 'string' &&
  typeof value.quoteAsset === 'string' &&
  typeof value.baseAssetPrecision === 'number' &&
  typeof value.quotePrecision === 'number' &&
  isOptionalNumber(value.pricePrecision) &&
  isOptionalNumber(value.quantityPrecision) &&
  typeof value.status === 'string' &&
  Array.isArray(value.filters) &&
  value.filters.every(isBinanceFilter) &&
  (value.permissions === undefined ||
    (Array.isArray(value.permissions) && value.permissions.every((item) => typeof item === 'string')));

const parseBinanceExchangeInfo = (value: unknown): BinanceExchangeInfo => {
  if (!isRecord(value) || !Array.isArray(value.symbols) || !value.symbols.every(isBinanceSymbol)) {
    throw new Error('Binance exchangeInfo response has an invalid shape');
  }
  return { symbols: value.symbols };
};

const defaultUrl = 'https://api.binance.com/api/v3/exchangeInfo';

export const fetchBinanceMarketStructure = async (apiUrl: string = defaultUrl): Promise<MarketStructureSnapshotData> => {
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Binance exchangeInfo: ${response.status}`);
  }
  const payload = parseBinanceExchangeInfo(await response.json());
  const exchange = { code: 'binance', name: 'Binance' } as const;

  const seenCurrencies = new Set<string>();
  const currencies: MarketStructureSnapshotData['currencies'] = [];
  const exchangeCurrencies: MarketStructureSnapshotData['exchangeCurrencies'] = [];
  const pairs: MarketStructureSnapshotData['pairs'] = [];
  const exchangePairs: VenueExchangePair[] = [];

  for (const symbol of payload.symbols ?? []) {
    const base = symbol.baseAsset.toUpperCase();
    const quote = symbol.quoteAsset.toUpperCase();

    if (!seenCurrencies.has(base)) {
      seenCurrencies.add(base);
      currencies.push({ symbol: base, assetClass: 'CRYPTO', decimals: symbol.baseAssetPrecision ?? 8 });
      exchangeCurrencies.push({ exchangeCode: exchange.code, currencySymbol: base, exchSymbol: symbol.baseAsset, status: 'trading' });
    }
    if (!seenCurrencies.has(quote)) {
      seenCurrencies.add(quote);
      currencies.push({ symbol: quote, assetClass: 'CRYPTO', decimals: symbol.quotePrecision ?? 8 });
      exchangeCurrencies.push({ exchangeCode: exchange.code, currencySymbol: quote, exchSymbol: symbol.quoteAsset, status: 'trading' });
    }

    const lotFilter = symbol.filters.find((filter) => filter.filterType === 'LOT_SIZE');
    const priceFilter = symbol.filters.find((filter) => filter.filterType === 'PRICE_FILTER');

    const pairSymbol = symbol.symbol.toUpperCase();
    pairs.push({
      symbol: pairSymbol,
      baseSymbol: base,
      quoteSymbol: quote,
      assetClass: 'SPOT',
      contractType: 'SPOT'
    });

    exchangePairs.push({
      exchangeCode: exchange.code,
      pairSymbol,
      exchSymbol: symbol.symbol,
      assetClass: 'SPOT',
      contractType: 'SPOT',
      lotSize: parseFiniteNumber(lotFilter?.stepSize) ?? 0,
      minLotSize: parseFiniteNumber(lotFilter?.minQty) ?? 0,
      maxLotSize: parseFiniteNumber(lotFilter?.maxQty) ?? null,
      tickSize: parseFiniteNumber(priceFilter?.tickSize) ?? 0,
      pricePrecision: symbol.pricePrecision ?? symbol.quotePrecision,
      quantityPrecision: symbol.quantityPrecision ?? symbol.baseAssetPrecision,
      quotePrecision: symbol.quotePrecision,
      status: symbol.status?.toLowerCase() ?? 'unknown',
      metadata: { permissions: symbol.permissions, filters: symbol.filters }
    });
  }

  return {
    exchange,
    currencies,
    pairs,
    exchangeCurrencies,
    exchangePairs,
    raw: payload
  };
};
