import { describe, expect, it } from 'vitest';
import { from, firstValueFrom } from 'rxjs';
import { simpleMomentumStrategy } from './simpleMomentum';
import type { MarketTick } from '@rx-trader/core/domain';

const tick = (overrides: Partial<{ price: number; t: number; symbol: string }> = {}) =>
  ({
    t: overrides.t ?? Date.now(),
    symbol: overrides.symbol ?? 'SIM',
    last: overrides.price ?? 100
  }) as MarketTick;

describe('simpleMomentumStrategy', () => {
  it('emits BUY when fast average crosses above slow after a reversal', async () => {
    const ticks = from([
      tick({ price: 104 }),
      tick({ price: 103 }),
      tick({ price: 102 }),
      tick({ price: 103 }),
      tick({ price: 104 }),
      tick({ price: 105 })
    ]);

    const signal = await firstValueFrom(
      simpleMomentumStrategy(ticks, { symbol: 'SIM', fastWindow: 2, slowWindow: 3 })
    );

    expect(signal.action).toBe('BUY');
  });

  it('emits SELL when fast average crosses below slow after a reversal', async () => {
    const ticks = from([
      tick({ price: 95 }),
      tick({ price: 96 }),
      tick({ price: 97 }),
      tick({ price: 96 }),
      tick({ price: 95 }),
      tick({ price: 94 })
    ]);

    const signal = await firstValueFrom(
      simpleMomentumStrategy(ticks, { symbol: 'SIM', fastWindow: 2, slowWindow: 3 })
    );

    expect(signal.action).toBe('SELL');
  });
});
