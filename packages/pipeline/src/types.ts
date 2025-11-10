import type { createLogger, createMetrics } from '@rx-trader/observability';

export type LoggerInstance = ReturnType<typeof createLogger>;
export type MetricsInstance = ReturnType<typeof createMetrics>;

export interface InstrumentMetadata {
  symbol: string;
  venue: string;
  baseAsset?: string;
  quoteAsset?: string;
  contractType?: string;
}
