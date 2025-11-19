import { describe, it, expect } from 'vitest';
import { Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { createExitEngine } from './exitEngine';
import type { StrategySignal } from '@rx-trader/strategies';
import { toPricePoints } from '@rx-trader/strategies/utils';
import { portfolio$, portfolioAnalytics$ } from '@rx-trader/portfolio';
import type { MarketTick, Fill, OrderNew } from '@rx-trader/core/domain';
import { createManualClock } from '@rx-trader/core/time';
import { randomUUID } from 'node:crypto';

const advanceAndEmit = (
  clock: ReturnType<typeof createManualClock>,
  subject: Subject<MarketTick>,
  tick: Omit<MarketTick, 't'>,
  delta = 1
) => {
  clock.advance(delta);
  subject.next({ ...tick, t: clock.now() });
};

describe('ExitEngine integration', () => {
  it('emits exit intents when signals flip against an open position', async () => {
    const clock = createManualClock(0);
    const fills$ = new Subject<Fill>();
    const marks$ = new Subject<MarketTick>();
    const signals$ = new Subject<StrategySignal>();

    const snapshots$ = portfolio$({
      fills$: fills$.asObservable(),
      marks$: marks$.asObservable(),
      initialCash: 0
    }, clock);
    const analytics$ = portfolioAnalytics$(snapshots$);
    const positions$ = snapshots$.pipe(map((snapshot) => snapshot.positions['BTCUSDT'] ?? null));

    const price$ = marks$.asObservable().pipe(toPricePoints('BTCUSDT'));

    const exitHandle = createExitEngine({
      strategyId: 'exit-demo',
      symbol: 'BTCUSDT',
      accountId: 'TEST',
      exit: {
        enabled: true,
        logVerbose: false,
        fairValue: { enabled: true, closeOnSignalFlip: true, epsilonBps: 0 }
      },
      clock,
      positions$,
      price$,
      signals$: signals$.asObservable(),
      analytics$
    });

    const exits: OrderNew[] = [];
    exitHandle.exitIntents$.subscribe((order) => exits.push(order));

    advanceAndEmit(clock, marks$, { symbol: 'BTCUSDT', bid: 100, ask: 100.1, last: 100.05 });
    signals$.next({ symbol: 'BTCUSDT', action: 'BUY', px: 100.1, t: clock.now() });

    fills$.next({
      id: randomUUID(),
      orderId: randomUUID(),
      t: clock.now(),
      symbol: 'BTCUSDT',
      px: 100.1,
      qty: 0.5,
      side: 'BUY'
    });

    advanceAndEmit(clock, marks$, { symbol: 'BTCUSDT', bid: 100.2, ask: 100.3, last: 100.25 });
    signals$.next({ symbol: 'BTCUSDT', action: 'SELL', px: 100.25, t: clock.now() });
    advanceAndEmit(clock, marks$, { symbol: 'BTCUSDT', bid: 100.3, ask: 100.5, last: 100.4 });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exits).toHaveLength(1);
    expect(exits[0]?.meta?.exit).toBe(true);
    expect(exits[0]?.meta?.reason).toBe('EXIT_SIGNAL_FLIP');
    expect(exits[0]?.side).toBe('SELL');

    exitHandle.stop();
  });
});
