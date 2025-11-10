import type { MarketStructureSnapshotData, VenueExchangePair } from '../types';

const defaultUrl = 'https://api.hyperliquid.xyz/info';

interface HyperliquidMetaResponse {
  universe?: Array<HyperliquidMarket>;
  perpetuals?: Array<HyperliquidMarket>;
  markets?: Array<HyperliquidMarket>;
}

interface HyperliquidMarket {
  coin: string;
  szDecimals?: number;
  pxDecimals?: number;
  minSize?: number;
  enabled?: boolean;
}

const calcStep = (decimals?: number) => {
  if (decimals === undefined) return 0;
  return Number((1 / Math.pow(10, decimals)).toFixed(decimals));
};

export const fetchHyperliquidMarketStructure = async (apiUrl: string = defaultUrl): Promise<MarketStructureSnapshotData> => {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'meta' })
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Hyperliquid meta: ${response.status}`);
  }

  const payload = (await response.json()) as HyperliquidMetaResponse;
  const markets = payload.perpetuals ?? payload.universe ?? payload.markets ?? [];
  if (!markets.length) {
    throw new Error('Hyperliquid meta response missing market data');
  }

  const exchange = { code: 'hyperliquid', name: 'Hyperliquid' } as const;
  const currencies: MarketStructureSnapshotData['currencies'] = [];
  const exchangeCurrencies: MarketStructureSnapshotData['exchangeCurrencies'] = [];
  const pairs: MarketStructureSnapshotData['pairs'] = [];
  const exchangePairs: VenueExchangePair[] = [];
  const seenCurrencies = new Set<string>();

  for (const market of markets) {
    const base = market.coin.toUpperCase();
    const quote = 'USDC';

    if (!seenCurrencies.has(base)) {
      seenCurrencies.add(base);
      currencies.push({ symbol: base, assetClass: 'CRYPTO' });
      exchangeCurrencies.push({ exchangeCode: exchange.code, currencySymbol: base, exchSymbol: market.coin, status: market.enabled === false ? 'disabled' : 'trading' });
    }
    if (!seenCurrencies.has(quote)) {
      seenCurrencies.add(quote);
      currencies.push({ symbol: quote, assetClass: 'CRYPTO' });
      exchangeCurrencies.push({ exchangeCode: exchange.code, currencySymbol: quote, exchSymbol: quote, status: 'trading' });
    }

    const canonicalSymbol = `${base}${quote}_PERP`;
    pairs.push({
      symbol: canonicalSymbol,
      baseSymbol: base,
      quoteSymbol: quote,
      assetClass: 'PERP',
      contractType: 'PERP'
    });

    const lotSize = calcStep(market.szDecimals);
    const tickSize = calcStep(market.pxDecimals);
    exchangePairs.push({
      exchangeCode: exchange.code,
      pairSymbol: canonicalSymbol,
      exchSymbol: market.coin,
      assetClass: 'PERP',
      contractType: 'PERP',
      lotSize,
      minLotSize: market.minSize ?? lotSize,
      tickSize,
      pricePrecision: market.pxDecimals,
      quantityPrecision: market.szDecimals,
      quotePrecision: market.pxDecimals,
      status: market.enabled === false ? 'disabled' : 'trading'
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
