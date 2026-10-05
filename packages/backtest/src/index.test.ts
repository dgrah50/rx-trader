import { describe, expect, it } from 'vitest';
import { StrategyType } from '@rx-trader/core/constants';
import type { Fill } from '@rx-trader/core/domain';
import { runBacktest } from './index';
import { verifyBacktestIntegrity } from './integrity';

const buildTick = (t: number, px: number) => ({
  t,
  symbol: 'BTCUSDT',
  bid: px,
  ask: px,
  last: px
});

describe('engine backtest runner', () => {
  it('replays ticks through the engine and produces order/fill events', async () => {
    const ticks = [104, 103, 102, 103, 104, 105].map((px, idx) => buildTick(idx + 1, px));

    const result = await runBacktest({
      ticks,
      symbol: 'BTCUSDT',
      strategy: {
        type: StrategyType.Momentum,
        params: {
          fastWindow: 2,
          slowWindow: 3
        }
      },
      execution: { makerFeeBps: 0, takerFeeBps: 0 }
    });

    expect(result.events.length).toBeGreaterThanOrEqual(0);
    expect(result.positions.positions).toBeTypeOf('object');
    expect(result.pnl).toBeDefined();
    expect(result.stats.ticksProcessed).toBe(ticks.length);
    expect(result.stats.nav).toBeDefined();
    expect(result.clock.startMs).toBe(ticks[0]!.t);
    expect(result.clock.ticks).toBe(ticks.length);
    expect(result.events.some((event) => event.type === 'portfolio.snapshot')).toBe(true);
    expect(result.events.some((event) => event.type === 'pnl.analytics')).toBe(true);
    expect(result.navCurve.length).toBeGreaterThan(0);

    const fillIds = result.events
      .filter((event) => event.type === 'order.fill')
      .map((event) => (event.data as Fill).id);
    expect(fillIds.length).toBeGreaterThan(0);
    expect(new Set(fillIds).size).toBe(fillIds.length);
    expect(result.integrity.status).toBe('verified');
    expect(result.integrity.checks.every((check) => check.passed)).toBe(true);

    const fillEvent = result.events.find((event) => event.type === 'order.fill')!;
    const corruptedEvents = [
      ...result.events,
      { ...fillEvent, id: crypto.randomUUID() },
    ];
    const corruptedCounts = {
      ...result.stats.eventCounts,
      orderFill: result.stats.eventCounts.orderFill + 1,
    };
    const corrupted = verifyBacktestIntegrity({
      ticks,
      config: {},
      events: corruptedEvents,
      positions: result.positions,
      pnl: result.pnl,
      eventCounts: corruptedCounts,
    });
    expect(corrupted.status).toBe('failed');
    expect(corrupted.checks.find((check) => check.name === 'unique-economic-keys')?.passed).toBe(
      false,
    );

    const repeated = await runBacktest({
      ticks,
      symbol: 'BTCUSDT',
      strategy: {
        type: StrategyType.Momentum,
        params: { fastWindow: 2, slowWindow: 3 },
      },
      execution: { makerFeeBps: 0, takerFeeBps: 0 },
    });
    expect(repeated.integrity.fingerprints.datasetSha256).toBe(
      result.integrity.fingerprints.datasetSha256,
    );
    expect(repeated.integrity.fingerprints.configSha256).toBe(
      result.integrity.fingerprints.configSha256,
    );
    expect(repeated.integrity.fingerprints.stateSha256).toBe(
      result.integrity.fingerprints.stateSha256,
    );
  });
});
