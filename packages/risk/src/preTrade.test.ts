import { describe, expect, it } from 'vitest';
import { asyncScheduler, firstValueFrom, from, observeOn, toArray } from 'rxjs';
import {
  createPreTradeRisk,
  splitRiskStream,
  type RiskLimits,
  type AccountExposureGuard
} from './preTrade';
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

    const notionalDecision = engine({ ...baseOrder, qty: 20 });
    expect(notionalDecision.allowed).toBe(false);
    expect(notionalDecision.reasons).toContain('notional>1000');

    const allowed = engine(baseOrder);
    expect(allowed.allowed).toBe(true);

    const positionDecision = engine({ ...baseOrder, qty: 10 });
    expect(positionDecision.allowed).toBe(false);
    expect(positionDecision.reasons).toContain('position>10');

    const bandDecision = engine({ ...baseOrder, px: 150 });
    expect(bandDecision.allowed).toBe(false);
    expect(bandDecision.reasons).toContain('price-band');

    const throttleDecision = engine({ ...baseOrder, id: 'order-2' });
    expect(throttleDecision.allowed).toBe(false);
    expect(throttleDecision.reasons).toContain('throttle');

    clock.advance(limits.throttle.windowMs + 1);
    const postThrottle = engine({ ...baseOrder, id: 'order-3' });
    expect(postThrottle.allowed).toBe(true);
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

    const insufficientQuote = engine(baseOrder);
    expect(insufficientQuote.allowed).toBe(false);
    expect(insufficientQuote.reasons).toContain('insufficient-quote');

    const sellOrder = { ...baseOrder, side: 'SELL' as const, qty: 5 };
    const sellDecision = engine(sellOrder);
    expect(sellDecision.allowed).toBe(false);
    expect(sellDecision.reasons).toContain('insufficient-base');
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
