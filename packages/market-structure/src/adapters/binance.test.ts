import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBinanceMarketStructure } from './binance';

describe('fetchBinanceMarketStructure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses exchange info into snapshot', async () => {
    const payload = {
      symbols: [
        {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          baseAssetPrecision: 8,
          quotePrecision: 8,
          pricePrecision: 2,
          quantityPrecision: 5,
          status: 'TRADING',
          filters: [
            { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.0001', maxQty: '100' },
            { filterType: 'PRICE_FILTER', tickSize: '0.01' }
          ],
          permissions: ['SPOT']
        }
      ]
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload
    } as Response);

    const snapshot = await fetchBinanceMarketStructure('https://example.com');
    expect(snapshot.exchange.code).toBe('binance');
    expect(snapshot.exchangePairs).toHaveLength(1);
    expect(snapshot.exchangePairs[0]?.lotSize).toBeCloseTo(0.001);
  });
});
