import { describe, expect, it } from 'vitest';
import { firstValueFrom, toArray } from 'rxjs';
import { SentimentFeedAdapter, type SentimentFeedAdapterOptions } from './sentimentFeed';

const samples = [
  { t: 1, symbol: 'BTC', score: 0.8, source: 'news' },
  { t: 2, symbol: 'BTC', score: -0.2, source: 'news' }
];

describe('SentimentFeedAdapter', () => {
  it('emits configured samples', async () => {
    const options: SentimentFeedAdapterOptions = { intervalMs: 1 };
    const feed = new SentimentFeedAdapter('sentiment', samples, options);
    const emitted = await firstValueFrom(feed.feed$.pipe(toArray()));
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.score).toBe(0.8);
  });
});
