import { describe, it, expect } from 'vitest';
import { createMarketExposureGuard } from './marketExposureGuard';

describe('createMarketExposureGuard', () => {
  const getAvail = (balances: Record<string, number>) => (venue: string, asset: string) => {
    return balances[`${venue}:${asset}`] ?? 0;
  };

  it('blocks spot cash short sells without base inventory', () => {
    const guard = createMarketExposureGuard({
      productType: 'SPOT',
      venue: 'binance',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      getAvailable: getAvail({ 'binance:BTC': 0, 'binance:USDT': 1000 })
    });
    expect(
      guard.canAccept(
        { id: 'o', t: 0, symbol: 'BTCUSDT', side: 'SELL', qty: 0.1, type: 'LMT', px: 100, tif: 'DAY', account: 'A' },
        10
      )
    ).toBe(false);
  });

  it('allows spot margin shorts when initial margin is available', () => {
    const guard = createMarketExposureGuard({
      productType: 'SPOT',
      venue: 'binance',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      leverageCap: 2,
      getAvailable: getAvail({ 'binance:BTC': 0, 'binance:USDT': 1000 })
    });
    // emulate margin by using leverageCap=2 and committing initial margin on update
    const order = { id: 's', t: 0, symbol: 'BTCUSDT', side: 'SELL', qty: 0.01, type: 'MKT', px: 1000, tif: 'DAY', account: 'A' } as const;
    const notional = 10; // 0.01 * 1000
    expect(guard.canAccept(order, notional)).toBe(true);
    guard.updateMargin(order);
    // After consuming part of the budget, ensure large notional is still gated
    expect(
      guard.canAccept(
        { ...order, id: 's2', qty: 2 },
        2000
      )
    ).toBe(false);
  });
});

