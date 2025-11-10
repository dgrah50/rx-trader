import { z } from 'zod';
import { symbolSchema, timestampSchema } from './primitives';

export interface SentimentSample {
  t: number;
  symbol: string;
  score: number; // -1 bearish to +1 bullish
  source: string;
}

export const sentimentSchema = z.object({
  t: timestampSchema,
  symbol: symbolSchema,
  score: z.number().min(-1).max(1),
  source: z.string().min(1)
});
