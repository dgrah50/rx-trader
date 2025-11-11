import type { createLogger, createMetrics } from '@rx-trader/observability';
import type { StrategyDefinition } from '@rx-trader/config';

export type LoggerInstance = ReturnType<typeof createLogger>;
export type MetricsInstance = ReturnType<typeof createMetrics>;

export interface InstrumentMetadata {
  symbol: string;
  venue: string;
  baseAsset?: string;
  quoteAsset?: string;
  contractType?: string;
}

export interface RuntimeStrategyConfig {
  definition: StrategyDefinition;
  venue?: string;
  tickSize?: number;
  lotSize?: number;
  baseAsset?: string;
  quoteAsset?: string;
  contractType?: string;
  fees?: {
    makerBps: number;
    takerBps: number;
    source?: string;
  };
  margin?: StrategyMarginConfig;
}

export interface StrategyMarginConfig {
  mode: 'cash' | 'margin' | 'perp';
  leverageCap: number;
  productType: 'SPOT' | 'PERP';
}
