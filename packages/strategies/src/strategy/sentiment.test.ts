import { describe, expect, it } from 'vitest';
import { from, firstValueFrom, toArray } from 'rxjs';
import { sentimentStrategy } from './sentiment';

const feed$ = from([
  { t: 1, symbol: 'BTC', score: 0.7, source: 'alt' },
  { t: 2, symbol: 'BTC', score: -0.8, source: 'alt' }
]);

describe('sentimentStrategy', () => {
  it('emits buy/sell signals based on sentiment thresholds', async () => {
    const signals = await firstValueFrom(
      sentimentStrategy(feed$, { symbol: 'BTC', buyThreshold: 0.5, sellThreshold: -0.5 }).pipe(toArray())
    );
    expect(signals).toHaveLength(2);
    expect(signals[0]?.action).toBe('BUY');
    expect(signals[1]?.action).toBe('SELL');
  });
});
