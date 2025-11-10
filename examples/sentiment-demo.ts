#!/usr/bin/env bun
import { SentimentFeedAdapter } from '@rx-trader/feeds';
import { sentimentStrategy } from '@rx-trader/strategies';
import type { OrderNew } from '@rx-trader/core/domain';

const samples = [
  { t: Date.now(), symbol: 'SIM', score: 0.9, source: 'news' },
  { t: Date.now() + 1_000, symbol: 'SIM', score: -0.7, source: 'social' }
];

const feed = new SentimentFeedAdapter('sentiment-demo', samples, { intervalMs: 500 });
const strategy$ = sentimentStrategy(feed.feed$, {
  symbol: 'SIM',
  buyThreshold: 0.6,
  sellThreshold: -0.6
});

strategy$.subscribe((signal) => {
  const order: OrderNew = {
    id: crypto.randomUUID(),
    t: signal.t,
    symbol: signal.symbol,
    side: signal.action,
    qty: 1,
    type: 'MKT',
    tif: 'DAY',
    account: 'SENTIMENT'
  };
  console.log('[sentiment] signal -> order', order);
});

feed.connect();
