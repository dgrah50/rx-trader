import { describe, expect, it } from 'vitest';
import { createMarketStructureStore } from './db';
import { MarketStructureRepository } from './repository';

const makeRepo = () => {
  const store = createMarketStructureStore(':memory:');
  return { repo: new MarketStructureRepository(store.db), close: store.close };
};

describe('MarketStructureRepository', () => {
  it('upserts exchange, pairs, and finds exchange pair', async () => {
    const { repo, close } = makeRepo();
    await repo.ensureExchange({ code: 'binance', name: 'Binance' });
    await repo.upsertCurrency({ symbol: 'BTC', assetClass: 'CRYPTO', decimals: 8 });
    await repo.upsertCurrency({ symbol: 'USDT', assetClass: 'CRYPTO', decimals: 6 });
    await repo.upsertPair({
      symbol: 'BTCUSDT',
      baseSymbol: 'BTC',
      quoteSymbol: 'USDT',
      assetClass: 'SPOT',
      contractType: 'SPOT'
    });
    await repo.upsertExchangeCurrency({
      exchangeCode: 'binance',
      currencySymbol: 'BTC',
      exchSymbol: 'BTC'
    });
    await repo.upsertExchangePair({
      exchangeCode: 'binance',
      pairSymbol: 'BTCUSDT',
      exchSymbol: 'BTCUSDT',
      lotSize: 0.001,
      minLotSize: 0.0001,
      tickSize: 0.01,
      assetClass: 'SPOT',
      contractType: 'SPOT'
    });

    const result = await repo.getExchangePair('binance', 'BTCUSDT');
    expect(result).toBeTruthy();
    expect(result?.exchangePair.lotSize).toBeCloseTo(0.001);
    close();
  });
});
