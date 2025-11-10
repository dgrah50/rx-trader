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

const defaultUrl = 'https://api.binance.com/api/v3/exchangeInfo';

const toNumber = (value?: string | number | null) => {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
};

export const fetchBinanceMarketStructure = async (apiUrl: string = defaultUrl): Promise<MarketStructureSnapshotData> => {
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Binance exchangeInfo: ${response.status}`);
  }
  const payload = (await response.json()) as BinanceExchangeInfo;
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
      lotSize: toNumber(lotFilter?.stepSize) ?? 0,
      minLotSize: toNumber(lotFilter?.minQty) ?? 0,
      maxLotSize: toNumber(lotFilter?.maxQty) ?? null,
      tickSize: toNumber(priceFilter?.tickSize) ?? 0,
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
