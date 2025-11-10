import { z } from 'zod';
import { timestampSchema, uuidSchema, symbolSchema } from './primitives';

const venueSchema = z.enum(['paper', 'binance', 'hyperliquid']);

const accountIdSchema = z.string().min(1);

const balanceEntrySchema = z.object({
  venue: venueSchema,
  asset: symbolSchema,
  available: z.number().default(0),
  locked: z.number().default(0),
  total: z.number().default(0),
  lastUpdated: timestampSchema
});
export type BalanceEntry = z.infer<typeof balanceEntrySchema>;

const marginSummarySchema = z.object({
  venue: venueSchema,
  equity: z.number(),
  marginUsed: z.number(),
  maintenance: z.number(),
  leverageCap: z.number().optional(),
  collateralAsset: symbolSchema
});
export type MarginSummary = z.infer<typeof marginSummarySchema>;

export const accountBalanceAdjustedSchema = z.object({
  id: uuidSchema,
  t: timestampSchema,
  accountId: accountIdSchema,
  venue: venueSchema,
  asset: symbolSchema,
  delta: z.number(),
  reason: z
    .enum(['deposit', 'withdrawal', 'funding', 'transfer', 'fee', 'manual', 'fill', 'sync'])
    .default('manual'),
  metadata: z.record(z.unknown()).optional()
});
export const accountMarginUpdatedSchema = z.object({
  id: uuidSchema,
  t: timestampSchema,
  accountId: accountIdSchema,
  venue: venueSchema,
  summary: marginSummarySchema
});
// Account-level events are consumed via DomainEvent<'account.margin.updated'> etc.;
// dedicated type aliases are unnecessary noise.

export const accountTransferSchema = z.object({
  id: uuidSchema,
  t: timestampSchema,
  accountId: accountIdSchema,
  fromVenue: venueSchema,
  toVenue: venueSchema,
  asset: symbolSchema,
  amount: z.number()
});
export type AccountTransfer = z.infer<typeof accountTransferSchema>;
