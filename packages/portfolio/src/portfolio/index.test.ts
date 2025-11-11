import { describe, expect, it } from 'vitest';
import { Subject } from 'rxjs';
import type { Fill, MarketTick, PortfolioSnapshot } from '@rx-trader/core/domain';
import { portfolio$ } from './index';
import { createManualClock } from '@rx-trader/core/time';

const createFill = (clock: ReturnType<typeof createManualClock>, overrides: Partial<Fill>): Fill => ({
  id: crypto.randomUUID(),
  orderId: crypto.randomUUID(),
  t: clock.now(),
  symbol: 'SIM',
  px: 100,
  qty: 1,
  side: 'BUY',
  ...overrides
});

const createMark = (clock: ReturnType<typeof createManualClock>, overrides: Partial<MarketTick>): MarketTick => ({
  t: clock.now(),
  symbol: 'SIM',
  last: 100,
  ...overrides
});

describe('portfolio$', () => {
  it('tracks position, cash, and pnl over fills and marks', () => {
    const clock = createManualClock(0);
    const fills$ = new Subject<Fill>();
    const marks$ = new Subject<MarketTick>();
    const snapshots: PortfolioSnapshot[] = [];

    const subscription = portfolio$({ fills$, marks$ }, clock).subscribe((snapshot) => snapshots.push(snapshot));

    clock.advance(1);
    fills$.next(createFill(clock, { qty: 2, px: 100, side: 'BUY' }));
    clock.advance(1);
    marks$.next(createMark(clock, { last: 102 }));
    clock.advance(1);
    fills$.next(createFill(clock, { qty: 1, px: 110, side: 'SELL' }));

    subscription.unsubscribe();

    const last = snapshots.at(-1);
    expect(last?.positions.SIM.pos).toBe(1);
    expect(last?.cash).toBeCloseTo(-90); // -200 buy +110 sell
    expect(last?.realized).toBeCloseTo(10);
    expect(last?.unrealized).toBeCloseTo(10);
    expect(last?.pnl).toBeCloseTo(20); // realized 10 + unrealized 10 (mark from latest fill)
    expect(last?.nav).toBeCloseTo(20); // cash + mark value
    expect(last?.feesPaid).toBeCloseTo(0);
  });

  it('handles partial closes and fees', () => {
    const clock = createManualClock(0);
    const fills$ = new Subject<Fill>();
    const marks$ = new Subject<MarketTick>();
    const snapshots: PortfolioSnapshot[] = [];

    const subscription = portfolio$({ fills$, marks$ }, clock).subscribe((snapshot) => snapshots.push(snapshot));

    clock.advance(1);
    fills$.next(createFill(clock, { qty: 2, px: 100, side: 'BUY' }));
    clock.advance(1);
    fills$.next(createFill(clock, { qty: 1, px: 105, side: 'SELL', fee: 1 }));
    clock.advance(1);
    marks$.next(createMark(clock, { last: 95 }));

    subscription.unsubscribe();

    const last = snapshots.at(-1)!;
    expect(last.positions.SIM.pos).toBe(1);
    expect(last.cash).toBeCloseTo(-96); // -200 +105 -1 fee
    // Realized: (105-100)*1 - fee = 4; Unrealized: (95-100)*1 = -5 => total -1
    expect(last.realized).toBeCloseTo(4);
    expect(last.unrealized).toBeCloseTo(-5);
    expect(last.pnl).toBeCloseTo(-1);
    expect(last.feesPaid).toBeCloseTo(1);
  });

  it('reduces NAV and cash by paid fees', () => {
    const clock = createManualClock(0);
    const fills$ = new Subject<Fill>();
    const marks$ = new Subject<MarketTick>();
    const snapshots: PortfolioSnapshot[] = [];

    const subscription = portfolio$({ fills$, marks$ }, clock).subscribe((snapshot) =>
      snapshots.push(snapshot)
    );

    clock.advance(1);
    fills$.next(createFill(clock, { qty: 1, px: 100, side: 'BUY', fee: 2 }));

    subscription.unsubscribe();

    const last = snapshots.at(-1)!;
    expect(last.cash).toBeCloseTo(-102);
    expect(last.positions.SIM.pos).toBe(1);
    expect(last.nav).toBeCloseTo(-2); // 100 notional - 102 cash
    expect(last.feesPaid).toBeCloseTo(2);
  });

  it('supports short positions and marks', () => {
    const clock = createManualClock(0);
    const fills$ = new Subject<Fill>();
    const marks$ = new Subject<MarketTick>();
    const snapshots: PortfolioSnapshot[] = [];

    const subscription = portfolio$({ fills$, marks$ }, clock).subscribe((snapshot) => snapshots.push(snapshot));

    clock.advance(1);
    fills$.next(createFill(clock, { qty: 1, px: 120, side: 'SELL' }));
    clock.advance(1);
    marks$.next(createMark(clock, { last: 110 }));

    subscription.unsubscribe();

    const last = snapshots.at(-1)!;
    expect(last.positions.SIM.pos).toBe(-1);
    expect(last.cash).toBeCloseTo(120);
    expect(last.realized).toBeCloseTo(0);
    expect(last.unrealized).toBeCloseTo(10);
    expect(last.pnl).toBeCloseTo(10); // short profit
    expect(last.nav).toBeCloseTo(10);
    expect(last.feesPaid).toBeCloseTo(0);
  });
  it('stamps snapshots with injected clock time', () => {
    const clock = createManualClock(1_000);
    const fills$ = new Subject<Fill>();
    const marks$ = new Subject<MarketTick>();
    const snapshots: PortfolioSnapshot[] = [];

    const subscription = portfolio$({ fills$, marks$ }, clock).subscribe((snapshot) => snapshots.push(snapshot));

    clock.advance(10);
    fills$.next(createFill(clock, { qty: 1, px: 100, side: 'BUY' }));
    clock.advance(5);
    marks$.next(createMark(clock, { last: 101 }));

    subscription.unsubscribe();

    const last = snapshots.at(-1)!;
    expect(last.t).toBe(clock.now());
    Object.values(last.positions).forEach((position) => {
      expect(position).toMatchObject({ t: clock.now() });
    });
  });

  it('initializes cash and applies external adjustments', () => {
    const clock = createManualClock(0);
    const fills$ = new Subject<Fill>();
    const marks$ = new Subject<MarketTick>();
    const cash$ = new Subject<number>();
    const snapshots: PortfolioSnapshot[] = [];

    const subscription = portfolio$(
      { fills$, marks$, cashAdjustments$: cash$, initialCash: 1_000 },
      clock
    ).subscribe((snapshot) => snapshots.push(snapshot));

    clock.advance(1);
    marks$.next(createMark(clock, { last: 100 }));
    expect(snapshots.at(-1)?.cash).toBeCloseTo(1_000);
    expect(snapshots.at(-1)?.nav).toBeCloseTo(1_000);

    cash$.next(500);
    expect(snapshots.at(-1)?.cash).toBeCloseTo(1_500);
    expect(snapshots.at(-1)?.nav).toBeCloseTo(1_500);

    subscription.unsubscribe();
  });
});
