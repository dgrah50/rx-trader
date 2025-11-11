import { describe, expect, it } from 'vitest';
import { createQuoteReserveGuard } from './quoteReserveGuard';
import type { BalanceEntry } from '@rx-trader/core/domain';

const balanceEntry = (available: number): BalanceEntry => ({
  venue: 'binance',
  asset: 'USDT',
  available,
  locked: 0,
  total: available,
  lastUpdated: Date.now()
});

describe('QuoteReserveGuard', () => {
  it('reduces available balance by pending reservations and releases correctly', () => {
    let current = balanceEntry(1000);
    const guard = createQuoteReserveGuard({
      venue: 'binance',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      getBalance: () => current
    });

    expect(guard.getAvailable('binance', 'USDT')).toBeCloseTo(1000);
    guard.reserve?.('order-1', 600);
    expect(guard.getAvailable('binance', 'USDT')).toBeCloseTo(400);
    guard.reserve?.('order-2', 200);
    expect(guard.getAvailable('binance', 'USDT')).toBeCloseTo(200);
    guard.consume?.('order-1', 300);
    expect(guard.getAvailable('binance', 'USDT')).toBeCloseTo(500);
    guard.consume?.('order-1', 400); // over-consume clamps to reservation
    expect(guard.getAvailable('binance', 'USDT')).toBeCloseTo(800);
    guard.release?.('order-1');
    expect(guard.getAvailable('binance', 'USDT')).toBeCloseTo(800);
    current = balanceEntry(500);
    expect(guard.getAvailable('binance', 'USDT')).toBeCloseTo(300);
    guard.release?.('order-2');
    expect(guard.getAvailable('binance', 'USDT')).toBeCloseTo(500);
  });

  it('treats missing balances as zero for the guarded venue', () => {
    const guard = createQuoteReserveGuard({
      venue: 'binance',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      getBalance: () => undefined
    });

    expect(guard.getAvailable('binance', 'USDT')).toBe(0);
    expect(guard.getAvailable('binance', 'BTC')).toBe(0);
    expect(guard.getAvailable('other', 'USDT')).toBeNull();
  });
});
