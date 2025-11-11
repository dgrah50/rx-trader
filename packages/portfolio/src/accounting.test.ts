import { describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import type { Fill } from '@rx-trader/core/domain';
import { wireFillAccounting } from './accounting';
import { createManualClock } from '@rx-trader/core/time';

describe('wireFillAccounting', () => {
  it('enqueues base/quote balance adjustments per fill', () => {
    const fills$ = new Subject<Fill>();
    const clock = createManualClock(1_000);
    const events: Array<{ type: string; data: any }> = [];
    const stop = wireFillAccounting({
      fills$,
      baseAsset: 'BTC',
      quoteAsset: 'USD',
      venue: 'paper-demo',
      accountId: 'ACC',
      clock,
      enqueue: (event) => events.push(event)
    });

    fills$.next({
      id: 'fill-1',
      orderId: 'order-1',
      t: 2_000,
      symbol: 'BTCUSDT',
      px: 50_000,
      qty: 0.1,
      side: 'BUY',
      fee: 5
    });

    fills$.next({
      id: 'fill-2',
      orderId: 'order-2',
      t: 2_500,
      symbol: 'BTCUSDT',
      px: 55_000,
      qty: 0.05,
      side: 'SELL',
      fee: 2.75
    });

    expect(events).toHaveLength(4);
    const deltas = events.map((event) => (event.data as any).delta);
    expect(deltas).toEqual([0.1, -5005, -0.05, 2747.25]);
    const reasons = events.map((event) => (event.data as any).reason);
    expect(reasons.every((reason) => reason === 'fill')).toBe(true);
    stop();
  });

  it('no-ops when base/quote assets missing', () => {
    const fills$ = new Subject<Fill>();
    const enqueue = vi.fn();
    const stop = wireFillAccounting({
      fills$,
      accountId: 'ACC',
      venue: 'paper',
      clock: createManualClock(0),
      enqueue
    });
    fills$.next({
      id: 'fill',
      orderId: 'order',
      t: 1,
      symbol: 'SIM',
      px: 100,
      qty: 1,
      side: 'BUY'
    });
    expect(enqueue).not.toHaveBeenCalled();
    stop();
  });
});
