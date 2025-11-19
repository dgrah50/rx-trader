import { describe, expect, it } from 'vitest';
import { firstValueFrom, take, timeout } from 'rxjs';
import { BinanceFeedAdapter } from './binance';

const runReal = process.env.RUN_REAL_FEED_TESTS !== 'false';

const maybe = runReal ? describe : describe.skip;

maybe('BinanceFeedAdapter (real WS)', () => {
  it('receives live bookTicker update', async () => {
    const adapter = new BinanceFeedAdapter({ symbol: 'btcusdt' });
    adapter.connect();
    try {
      const tick = await firstValueFrom(
        adapter.feed$.pipe(take(1), timeout({ each: 15000 }))
      );
      expect(tick.symbol).toBe('BTCUSDT');
      expect(tick.t).toBeGreaterThan(0);
    } finally {
      adapter.disconnect();
    }
  });
});
