import { describe, expect, it } from 'vitest';
import { from, lastValueFrom, mergeMap, last } from 'rxjs';
import { simpleMomentumStrategy } from '@rx-trader/strategies';
import { ExecutionVenue } from '@rx-trader/core/constants';
import { InMemoryEventStore, buildProjection, positionsProjection } from '@rx-trader/event-store';
import { PaperExecutionAdapter } from '@rx-trader/execution';
import type { OrderNew } from '@rx-trader/core/domain';

const ticks = from(
  [104, 103, 102, 103, 104, 105].map((price, idx) => ({
    t: Date.now() + idx,
    symbol: 'SIM',
    last: price
  }))
);

describe('runtime pipeline integration', () => {
  it('processes feed → strategy → execution and replays positions', async () => {
    const store = new InMemoryEventStore();
    const exec = new PaperExecutionAdapter(ExecutionVenue.Paper);
    exec.events$.subscribe(async (event) => {
      await store.append(event);
    });

    const signals$ = simpleMomentumStrategy(ticks, { symbol: 'SIM', fastWindow: 2, slowWindow: 3 });

    await lastValueFrom(
      signals$.pipe(
        mergeMap(async (signal) => {
          const order: OrderNew = {
            id: crypto.randomUUID(),
            t: Date.now(),
            symbol: signal.symbol,
            side: signal.action,
            qty: 1,
            type: 'MKT',
            tif: 'DAY',
            account: 'DEMO'
          };
          await store.append({
            id: crypto.randomUUID(),
            type: 'order.new',
            data: order,
            ts: Date.now()
          });
          await exec.submit(order);
        }),
        last()
      )
    );

    const snapshot = {
      id: crypto.randomUUID(),
      type: 'portfolio.snapshot' as const,
      data: {
        t: Date.now(),
        positions: {
          SIM: {
            t: Date.now(),
            symbol: 'SIM',
            pos: 1,
            px: 105,
            avgPx: 100,
            unrealized: 5,
            realized: 0,
            netRealized: 0,
            grossRealized: 0,
            notional: 105,
            pnl: 5
          }
        },
        nav: 105,
        pnl: 5,
        realized: 0,
        netRealized: 0,
        grossRealized: 0,
        unrealized: 5,
        cash: 0,
        feesPaid: 0
      },
      ts: Date.now()
    };
    await store.append(snapshot);

    const state = await buildProjection(store, positionsProjection);
    expect(state.positions.SIM?.pos).toBeDefined();

    const replayed = await buildProjection(store, positionsProjection);
    expect(replayed.positions.SIM?.pos).toEqual(state.positions.SIM?.pos);
  });
});
