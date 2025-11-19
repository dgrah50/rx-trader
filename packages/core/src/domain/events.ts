import { z } from 'zod';
import { barSchema, marketTickSchema } from './market';
import {
  orderAckSchema,
  orderCancelReqSchema,
  orderNewSchema,
  orderRejectSchema
} from './orders';
import {
  fillSchema,
  portfolioSnapshotSchema,
  portfolioAnalyticsSchema,
  positionMarkSchema
} from './portfolio';
import { sentimentSchema } from './sentiment';
import { timestampSchema, uuidSchema } from './primitives';
import { safeParse } from '../validation';
import {
  accountBalanceAdjustedSchema,
  accountBalanceSnapshotSchema,
  accountMarginUpdatedSchema,
  accountTransferSchema
} from './account';

const domainEventTypes = [
  'market.tick',
  'market.bar',
  'strategy.signal',
  'strategy.intent',
  'risk.check',
  'order.new',
  'order.ack',
  'order.reject',
  'order.cancel',
  'order.fill',
  'portfolio.snapshot',
  'position.mark',
  'sentiment.update',
  'pnl.analytics',
  'backtest.artifact',
  'account.balance.adjusted',
  'account.balance.snapshot',
  'account.margin.updated',
  'account.transfer',
  'account.transfer.requested'
] as const;

type DomainEventType = (typeof domainEventTypes)[number];

export interface DomainEvent<TType extends DomainEventType = DomainEventType, TData = unknown> {
  id: string;
  type: TType;
  data: TData;
  ts: number;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

// --- New Schemas ---

export const strategySignalSchema = z.object({
  strategyId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  strength: z.number(),
  reasons: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional()
});

export const strategyIntentSchema = z.object({
  strategyId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  qty: z.number().optional(),
  targetSize: z.number().optional(),
  urgency: z.enum(['low', 'medium', 'high']).optional(),
  metadata: z.record(z.unknown()).optional()
});

export const riskCheckSchema = z.object({
  orderId: z.string(),
  passed: z.boolean(),
  reasons: z.array(z.string()).optional(),
  snapshot: z.record(z.unknown()).optional(), // Snapshot of relevant state (balances, margin, etc.)
  metadata: z.record(z.unknown()).optional()
});

// -------------------

const domainEventSchema = z.object({
  id: uuidSchema,
  type: z.enum(domainEventTypes),
  data: z.unknown(),
  ts: timestampSchema,
  traceId: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

export const domainEventDataSchemas: Record<DomainEventType, z.ZodTypeAny> = {
  'market.tick': marketTickSchema,
  'market.bar': barSchema,
  'strategy.signal': strategySignalSchema,
  'strategy.intent': strategyIntentSchema,
  'risk.check': riskCheckSchema,
  'order.new': orderNewSchema,
  'order.ack': orderAckSchema,
  'order.reject': orderRejectSchema,
  'order.cancel': orderCancelReqSchema,
  'order.fill': fillSchema,
  'portfolio.snapshot': portfolioSnapshotSchema,
  'position.mark': positionMarkSchema,
  'sentiment.update': sentimentSchema,
  'pnl.analytics': portfolioAnalyticsSchema,
  'backtest.artifact': z.unknown(),
  'account.balance.adjusted': accountBalanceAdjustedSchema,
  'account.balance.snapshot': accountBalanceSnapshotSchema,
  'account.margin.updated': accountMarginUpdatedSchema,
  'account.transfer': accountTransferSchema,
  'account.transfer.requested': accountTransferSchema
};

export const validateDomainEvent = (event: DomainEvent): DomainEvent => {
  const parsed = safeParse(domainEventSchema, event);
  const schema = domainEventDataSchemas[event.type];
  if (!schema) {
    throw new Error(`Unknown event type: ${event.type}`);
  }
  const data = safeParse(schema, parsed.data);
  return { ...parsed, data } as DomainEvent;
};
