import { describe, expect, it } from 'vitest';
import {
  domainEventDataSchemas,
  marketTickSchema,
  orderNewSchema,
  portfolioSnapshotSchema,
  portfolioAnalyticsSchema
} from './index';

describe('domain schemas', () => {
  it('validates market ticks', () => {
    const payload = {
      t: Date.now(),
      symbol: 'AAPL',
      bid: 100,
      ask: 100.1
    };
    expect(() => marketTickSchema.parse(payload)).not.toThrow();
  });

  it('rejects malformed orders', () => {
    const payload = {
      id: 'not-a-uuid',
      t: Date.now(),
      symbol: 'AAPL',
      side: 'BUY',
      qty: 1,
      type: 'LMT',
      tif: 'DAY',
      account: 'TEST'
    };
    expect(() => orderNewSchema.parse(payload)).toThrow();
  });

  it('validates portfolio snapshot through event schema map', () => {
    const data = {
      t: Date.now(),
      positions: {
        AAPL: {
          t: Date.now(),
          symbol: 'AAPL',
          pos: 100,
          px: 105,
          avgPx: 100,
          unrealized: 500,
          realized: 0,
          netRealized: 0,
          grossRealized: 0,
          notional: 10_500,
          pnl: 500
        }
      },
      nav: 100_000,
      pnl: 1_200,
      realized: 800,
      netRealized: 800,
      grossRealized: 800,
      unrealized: 400,
      cash: 80_000,
      feesPaid: 25
    };
    expect(() => portfolioSnapshotSchema.parse(data)).not.toThrow();
    expect(() => domainEventDataSchemas['portfolio.snapshot'].parse(data)).not.toThrow();
  });

  it('validates pnl analytics payloads', () => {
    const data = {
      t: Date.now(),
      nav: 100_500,
      pnl: 500,
      realized: 300,
      netRealized: 300,
      grossRealized: 300,
      unrealized: 200,
      cash: 80_100,
      peakNav: 101_000,
      drawdown: -500,
      drawdownPct: -0.0049,
      symbols: {
        BTCUSDT: {
          symbol: 'BTCUSDT',
          pos: 0.5,
          avgPx: 60_000,
          markPx: 61_000,
          realized: 100,
          netRealized: 100,
          grossRealized: 100,
          unrealized: 500,
          notional: 30_500
        }
      }
    };
    expect(() => portfolioAnalyticsSchema.parse(data)).not.toThrow();
    expect(() => domainEventDataSchemas['pnl.analytics'].parse(data)).not.toThrow();
  });
});
