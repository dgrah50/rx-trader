import { describe, expect, it } from 'vitest';
import { firstValueFrom, retry, take, timeout } from 'rxjs';
import { HyperliquidFeedAdapter } from './hyperliquid';

const runReal = process.env.RUN_REAL_FEED_TESTS !== 'false';
const maybe = runReal ? describe : describe.skip;

maybe('HyperliquidFeedAdapter (real WS)', () => {
  it('receives live ticker update', async () => {
    const adapter = new HyperliquidFeedAdapter({ coin: 'BTC', subscriptionType: 'trades' });
    adapter.connect();
    try {
      const tick = await firstValueFrom(
        adapter.feed$.pipe(
          timeout({ first: 20000 }),
          retry({ count: 2 }),
          take(1)
        )
      );
      expect(tick.symbol).toBe('BTC');
      expect(tick.t).toBeGreaterThan(0);
      expect(tick.last).toBeGreaterThan(0);
    } finally {
      adapter.disconnect();
    }
  }, 45000);
});
