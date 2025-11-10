import { z } from 'zod';
import {
  micSchema,
  sideSchema,
  symbolSchema,
  tifSchema,
  timestampSchema,
  uuidSchema,
  orderTypeSchema
} from './primitives';

export interface OrderNew {
  id: string;
  t: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  type: 'MKT' | 'LMT';
  px?: number;
  tif: 'IOC' | 'FOK' | 'DAY';
  account: string;
  meta?: Record<string, unknown>;
}

export const orderNewSchema = z
  .object({
    id: uuidSchema,
    t: timestampSchema,
    symbol: symbolSchema,
    side: sideSchema,
    qty: z.number().positive(),
    type: orderTypeSchema,
    px: z.number().positive().optional(),
    tif: tifSchema,
    account: z.string().min(3),
    meta: z.record(z.unknown()).optional()
  })
  .superRefine((order, ctx) => {
    if (order.type === 'LMT' && typeof order.px !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'limit orders require px'
      });
    }
  });

export interface OrderAck {
  id: string;
  t: number;
  venue: string;
}

export const orderAckSchema = z.object({
  id: uuidSchema,
  t: timestampSchema,
  venue: micSchema
});

export interface OrderReject {
  id: string;
  t: number;
  reason: string;
}

export const orderRejectSchema = z.object({
  id: uuidSchema,
  t: timestampSchema,
  reason: z.string().min(3)
});

export interface OrderCancelReq {
  id: string;
  t: number;
}

export const orderCancelReqSchema = z.object({
  id: uuidSchema,
  t: timestampSchema
});
