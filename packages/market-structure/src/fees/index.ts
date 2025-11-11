import type { MarketStructureRepository } from '../repository';
import type { FeeScheduleUpsert } from '../types';
import { fetchBinanceFees, type BinanceFeeFetcherOptions } from './binance';
import { fetchHyperliquidFees, type HyperliquidFeeFetcherOptions } from './hyperliquid';

export type FeeSyncVenue = 'binance' | 'hyperliquid';

export interface FeeSyncOptions {
  repo: MarketStructureRepository;
  venue: FeeSyncVenue;
  productType?: string;
  timestamp?: number;
  binance?: BinanceFeeFetcherOptions;
  hyperliquid?: HyperliquidFeeFetcherOptions;
}

export const syncFeeSchedules = async (options: FeeSyncOptions) => {
  const timestamp = options.timestamp ?? Date.now();
  let entries: FeeScheduleUpsert[] = [];
  if (options.venue === 'binance') {
    entries = await fetchBinanceFees({
      ...(options.binance ?? {}),
      productType: options.productType ?? 'SPOT',
      timestamp
    });
  } else if (options.venue === 'hyperliquid') {
    entries = await fetchHyperliquidFees({ ...(options.hyperliquid ?? {}), timestamp });
  } else {
    throw new Error(`Unsupported venue '${options.venue}' for fee sync`);
  }

  if (!entries.length) {
    throw new Error(`No fee entries returned for venue ${options.venue}`);
  }
  await options.repo.upsertFeeSchedules(entries);
  return entries.length;
};

export { fetchBinanceFees, fetchHyperliquidFees };
