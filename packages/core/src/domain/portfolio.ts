import { z } from 'zod';
import { sideSchema, symbolSchema, timestampSchema, uuidSchema } from './primitives';

export interface Fill {
  id: string;
  orderId: string;
  t: number;
  symbol: string;
  px: number;
  qty: number;
  fee?: number;
  liquidity?: 'MAKER' | 'TAKER';
  side: 'BUY' | 'SELL';
}

export const fillSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  t: timestampSchema,
  symbol: symbolSchema,
  px: z.number().positive(),
  qty: z.number().positive(),
  fee: z.number().nonnegative().optional(),
  liquidity: z.enum(['MAKER', 'TAKER']).optional(),
  side: sideSchema
});

interface PositionMark {
  t: number;
  symbol: string;
  pos: number;
  px: number;
  avgPx: number;
  unrealized: number;
  realized: number;
  notional: number;
}

export const positionMarkSchema = z.object({
  t: timestampSchema,
  symbol: symbolSchema,
  pos: z.number(),
  px: z.number().positive(),
  avgPx: z.number(),
  unrealized: z.number(),
  realized: z.number(),
  notional: z.number()
});

export interface PortfolioSnapshot {
  t: number;
  positions: Record<string, PositionMark>;
  nav: number;
  pnl: number;
  realized: number;
  unrealized: number;
  cash: number;
}

export const portfolioSnapshotSchema = z.object({
  t: timestampSchema,
  positions: z.record(positionMarkSchema),
  nav: z.number(),
  pnl: z.number(),
  realized: z.number(),
  unrealized: z.number(),
  cash: z.number()
});

export interface PortfolioAnalytics {
  t: number;
  nav: number;
  pnl: number;
  realized: number;
  unrealized: number;
  cash: number;
  peakNav: number;
  drawdown: number;
  drawdownPct: number;
  symbols: Record<
    string,
    {
      symbol: string;
      pos: number;
      avgPx: number;
      markPx: number;
      realized: number;
      unrealized: number;
      notional: number;
    }
  >;
}

export const portfolioAnalyticsSchema = z.object({
  t: timestampSchema,
  nav: z.number(),
  pnl: z.number(),
  realized: z.number().default(0),
  unrealized: z.number().default(0),
  cash: z.number(),
  peakNav: z.number(),
  drawdown: z.number(),
  drawdownPct: z.number(),
  symbols: z.record(
    z.object({
      symbol: symbolSchema,
      pos: z.number(),
      avgPx: z.number(),
      markPx: z.number(),
      realized: z.number().default(0),
      unrealized: z.number().default(0),
      notional: z.number()
    })
  )
});
