import { describe, expect, it } from 'vitest';
import { asyncScheduler, firstValueFrom, from, observeOn, toArray } from 'rxjs';
import {
  createPreTradeRisk,
  splitRiskStream,
  type RiskLimits,
  type AccountExposureGuard
} from './preTrade';
import { createMarketExposureGuard } from './marketExposureGuard';
import { createManualClock } from '@rx-trader/core/time';

const limits: RiskLimits = {
  notional: 1_000,
  maxPosition: 10,
  priceBands: { SIM: { min: 90, max: 110 } },
  throttle: { windowMs: 1_000, maxCount: 2 }
};

const baseOrder = {
  id: 'order-1',
  t: 0,
  symbol: 'SIM',
  side: 'BUY' as const,
  qty: 5,
  type: 'LMT' as const,
  px: 100,
  tif: 'DAY' as const,
  account: 'TEST'
};

describe('createPreTradeRisk', () => {
  it('rejects orders that violate notional, position, price band, and throttle rules', () => {
    const clock = createManualClock(0);
    const engine = createPreTradeRisk(limits, clock.now);

    const notionalDecision = engine.check({ ...baseOrder, qty: 20 });
    expect(notionalDecision.allowed).toBe(false);
    expect(notionalDecision.reasons).toContain('notional>1000');

    const allowed = engine.check(baseOrder);
    expect(allowed.allowed).toBe(true);

    const positionDecision = engine.check({ ...baseOrder, qty: 10 });
    expect(positionDecision.allowed).toBe(false);
    expect(positionDecision.reasons).toContain('position>10');

    const bandDecision = engine.check({ ...baseOrder, px: 150 });
    expect(bandDecision.allowed).toBe(false);
    expect(bandDecision.reasons).toContain('price-band');

    const marketBandDecision = engine.check({ ...baseOrder, type: 'MKT', px: undefined, meta: { execRefPx: 150 } });
    expect(marketBandDecision.allowed).toBe(false);
    expect(marketBandDecision.reasons).toContain('price-band');

    const throttleDecision = engine.check({ ...baseOrder, id: 'order-2' });
    expect(throttleDecision.allowed).toBe(false);
    expect(throttleDecision.reasons).toContain('throttle');

    clock.advance(limits.throttle.windowMs + 1);
    const postThrottle = engine.check({ ...baseOrder, id: 'order-3' });
    expect(postThrottle.allowed).toBe(true);
  });

  it('uses execRefPx and expected fees when computing notional budgets', () => {
    const engine = createPreTradeRisk(limits);
    const marketOrder = {
      ...baseOrder,
      type: 'MKT' as const,
      px: undefined,
      qty: 9,
      meta: { execRefPx: 120, expectedFeeBps: 50 }
    };
    const decision = engine.check(marketOrder);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('notional>1000');
  });

  it('rejects orders when account balances are insufficient', () => {
    const clock = createManualClock(0);
    const guard: AccountExposureGuard = {
      venue: 'paper',
      baseAsset: 'SIM',
      quoteAsset: 'USD',
      getAvailable: (venue, asset) => {
        if (venue !== 'paper') return null;
        if (asset === 'USD') return 100;
        if (asset === 'SIM') return 1;
        return null;
      }
    };
    const engine = createPreTradeRisk(limits, clock.now, guard);

    const insufficientQuote = engine.check(baseOrder);
    expect(insufficientQuote.allowed).toBe(false);
    expect(insufficientQuote.reasons).toContain('insufficient-quote');

    const nearEdgeGuard: AccountExposureGuard = {
      ...guard,
      getAvailable: (venue, asset) => {
        if (venue !== 'paper') return null;
        if (asset === 'USD') return 500;
        if (asset === 'SIM') return 5;
        return null;
      }
    };
    const feeAwareEngine = createPreTradeRisk(limits, clock.now, nearEdgeGuard);
    const quoteTightOrder = {
      ...baseOrder,
      qty: 5,
      px: 100,
      meta: { expectedFeeBps: 20 }
    };
    const quoteDecision = feeAwareEngine.check(quoteTightOrder);
    expect(quoteDecision.allowed).toBe(false);
    expect(quoteDecision.reasons).toContain('insufficient-quote');

    const sellOrder = { ...baseOrder, side: 'SELL' as const, qty: 5 };
    const sellDecision = engine.check(sellOrder);
    expect(sellDecision.allowed).toBe(false);
    expect(sellDecision.reasons).toContain('insufficient-base');
  });

  it('blocks buys that exceed available quote balance', () => {
    const guard: AccountExposureGuard = {
      venue: 'paper',
      baseAsset: 'SIM',
      quoteAsset: 'USD',
      getAvailable: (venue, asset) => {
        if (venue !== 'paper') return null;
        if (asset === 'USD') return 200;
        if (asset === 'SIM') return 0;
        return null;
      }
    };
    const engine = createPreTradeRisk(limits, undefined, guard);
    const decision = engine.check({ ...baseOrder, qty: 3, px: 80 });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('insufficient-quote');
  });

  it('allows margin shorts within leverage budget and blocks beyond', () => {
    const marginGuard = createMarketExposureGuard({
      productType: 'SPOT',
      venue: 'paper',
      baseAsset: 'SIM',
      quoteAsset: 'USD',
      leverageCap: 2,
      getAvailable: () => 500
    });
    const engine = createPreTradeRisk(limits, undefined, undefined, marginGuard);
    const shortOk = engine.check({ ...baseOrder, side: 'SELL', qty: 2, px: 100 });
    expect(shortOk.allowed).toBe(true);
    const shortExceeded = engine.check({ ...baseOrder, id: 'order-spot-margin', side: 'SELL', qty: 9, px: 100 });
    expect(shortExceeded.allowed).toBe(false);
    expect(shortExceeded.reasons).toContain('insufficient-balance');
  });

  it('tracks perp margin usage and prevents exceeding collateral', () => {
    const perpGuard = createMarketExposureGuard({
      productType: 'PERP',
      venue: 'paper',
      baseAsset: 'SIM',
      quoteAsset: 'USD',
      leverageCap: 1,
      getAvailable: () => 800
    });
    const engine = createPreTradeRisk(limits, undefined, undefined, perpGuard);
    const first = engine.check({ ...baseOrder, side: 'SELL', qty: 4, px: 100 });
    expect(first.allowed).toBe(true);
    const second = engine.check({ ...baseOrder, id: 'order-perp-2', side: 'SELL', qty: 5, px: 100 });
    expect(second.allowed).toBe(false);
    expect(second.reasons).toContain('insufficient-balance');
  });

  it('blocks market orders that exceed quote balance', () => {
    const guard: AccountExposureGuard = {
      venue: 'binance',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      getAvailable: (venue, asset) => {
        if (venue !== 'binance') return null;
        if (asset === 'USDT') return 500;
        return 1;
      }
    };
    const engine = createPreTradeRisk(limits, undefined, guard);
    const marketOrder = {
      ...baseOrder,
      type: 'MKT' as const,
      px: undefined,
      meta: { execRefPx: 200 }
    };
    const decision = engine.check(marketOrder);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('insufficient-quote');
  });

  it('bypasses throttle limits for exit orders and ignores collateral checks', () => {
    const clock = createManualClock(0);
    const guard: AccountExposureGuard = {
      venue: 'paper',
      baseAsset: 'SIM',
      quoteAsset: 'USD',
      getAvailable: () => 0
    };
    const engine = createPreTradeRisk(limits, clock.now, guard);
    engine.check(baseOrder);
    const exitOrder = engine.check({
      ...baseOrder,
      id: 'exit-1',
      side: 'SELL',
      qty: baseOrder.qty,
      meta: { exit: true }
    });
    expect(exitOrder.allowed).toBe(true);

    engine.check({ ...baseOrder, id: 'order-throttle-1' });
    engine.check({ ...baseOrder, id: 'order-throttle-2' });
    const throttledExit = engine.check({
      ...baseOrder,
      id: 'exit-throttle',
      side: 'SELL',
      qty: 1,
      meta: { exit: true }
    });
    expect(throttledExit.allowed).toBe(true);
  });
});

describe('splitRiskStream', () => {
  it('partitions allowed and rejected orders', async () => {
    const clock = createManualClock(0);
    const orders$ = from([
      baseOrder,
      { ...baseOrder, id: 'order-2', qty: 20 },
      { ...baseOrder, id: 'order-3' }
    ]).pipe(observeOn(asyncScheduler));
    const [approved$, rejected$] = splitRiskStream(orders$, limits, clock);

    const [approved, rejected] = await Promise.all([
      firstValueFrom(approved$.pipe(toArray())),
      firstValueFrom(rejected$.pipe(toArray()))
    ]);

    expect(approved).toHaveLength(1);
    expect(rejected.map((decision) => decision.order.id)).toEqual(['order-2', 'order-3']);
  });
});
