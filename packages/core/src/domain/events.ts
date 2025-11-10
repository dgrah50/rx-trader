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
  accountMarginUpdatedSchema,
  accountTransferSchema
} from './account';

const domainEventTypes = [
  'market.tick',
  'market.bar',
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
  metadata?: Record<string, unknown>;
}

const domainEventSchema = z.object({
  id: uuidSchema,
  type: z.enum(domainEventTypes),
  data: z.unknown(),
  ts: timestampSchema,
  metadata: z.record(z.unknown()).optional()
});

export const domainEventDataSchemas: Record<DomainEventType, z.ZodTypeAny> = {
  'market.tick': marketTickSchema,
  'market.bar': barSchema,
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
