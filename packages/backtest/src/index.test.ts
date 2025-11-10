import { describe, expect, it } from 'vitest';
import { StrategyType } from '@rx-trader/core/constants';
import { runBacktest } from './index';

const buildTick = (t: number, px: number) => ({
  t,
  symbol: 'SIM',
  bid: px - 0.1,
  ask: px + 0.1,
  last: px
});

describe('engine backtest runner', () => {
  it('replays ticks through the engine and produces order/fill events', async () => {
    const ticks = [100, 99, 98, 105, 104].map((px, idx) => buildTick(idx + 1, px));

    const result = await runBacktest({
      ticks,
      symbol: 'SIM',
      strategy: {
        type: StrategyType.Momentum,
        params: {
          fastWindow: 1,
          slowWindow: 3
        }
      }
    });

    expect(result.events.length).toBeGreaterThanOrEqual(0);
    expect(result.positions.positions).toBeTypeOf('object');
    expect(result.pnl).toBeDefined();
    expect(result.stats.ticksProcessed).toBe(ticks.length);
    expect(result.stats.nav).toBeDefined();
    expect(result.clock.startMs).toBe(ticks[0]!.t);
    expect(result.clock.ticks).toBe(ticks.length);
  });
});
