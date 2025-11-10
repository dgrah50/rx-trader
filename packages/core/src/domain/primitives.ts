import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const micSchema = z.string().min(3);
export const symbolSchema = z
  .string()
  .regex(/^[-A-Z0-9_:.]+$/, 'symbols must be uppercase and may contain _ : . -');

export const timestampSchema = z.number().int().nonnegative();

export const sideSchema = z.enum(['BUY', 'SELL']);
export const orderTypeSchema = z.enum(['MKT', 'LMT']);
export const tifSchema = z.enum(['IOC', 'FOK', 'DAY']);
