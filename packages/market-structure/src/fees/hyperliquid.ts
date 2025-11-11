import type { FeeScheduleUpsert } from '../types';

export interface HyperliquidFeeFetcherOptions {
  baseUrl?: string;
  timestamp?: number;
}

const HYPERLIQUID_DEFAULT = { makerBps: -2, takerBps: 5 };

export const fetchHyperliquidFees = async (
  options: HyperliquidFeeFetcherOptions = {}
): Promise<FeeScheduleUpsert[]> => {
  const ts = options.timestamp ?? Date.now();
  const url = options.baseUrl ?? 'https://api.hyperliquid.xyz/info';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'meta' })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as Record<string, any>;
    const perpFees = data?.meta?.perpFees ?? data?.perpFees;
    const maker = Number(perpFees?.makerFee ?? HYPERLIQUID_DEFAULT.makerBps / 10_000);
    const taker = Number(perpFees?.takerFee ?? HYPERLIQUID_DEFAULT.takerBps / 10_000);
    return [
      {
        exchangeCode: 'hyperliquid',
        symbol: '*',
        productType: 'PERP',
        makerBps: Number.isFinite(maker) ? maker * 10_000 : HYPERLIQUID_DEFAULT.makerBps,
        takerBps: Number.isFinite(taker) ? taker * 10_000 : HYPERLIQUID_DEFAULT.takerBps,
        effectiveFrom: Math.floor(ts / 1000),
        source: 'hyperliquid:meta'
      } satisfies FeeScheduleUpsert
    ];
  } catch (error) {
    return [
      {
        exchangeCode: 'hyperliquid',
        symbol: '*',
        productType: 'PERP',
        makerBps: HYPERLIQUID_DEFAULT.makerBps,
        takerBps: HYPERLIQUID_DEFAULT.takerBps,
        effectiveFrom: Math.floor(ts / 1000),
        source: 'default',
        metadata: { error: (error as Error).message }
      }
    ];
  }
};
