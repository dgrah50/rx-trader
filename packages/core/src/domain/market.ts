import { z } from 'zod';
import { symbolSchema, timestampSchema } from './primitives';

export interface MarketTick {
  t: number;
  symbol: string;
  bid?: number;
  ask?: number;
  last?: number;
  bidSz?: number;
  askSz?: number;
}

export const marketTickSchema = z
  .object({
    t: timestampSchema,
    symbol: symbolSchema,
    bid: z.number().positive().optional(),
    ask: z.number().positive().optional(),
    last: z.number().positive().optional(),
    bidSz: z.number().positive().optional(),
    askSz: z.number().positive().optional()
  })
  .refine((tick) => Boolean(tick.bid ?? tick.ask ?? tick.last), {
    message: 'at least one price field (bid/ask/last) is required'
  });

const timeframeSchema = z.enum(['1s', '1m', '5m', '1h']);

export const barSchema = z.object({
  t: timestampSchema,
  symbol: symbolSchema,
  o: z.number().positive(),
  h: z.number().positive(),
  l: z.number().positive(),
  c: z.number().positive(),
  v: z.number().nonnegative(),
  tf: timeframeSchema
});
