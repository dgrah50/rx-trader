import type { FeeScheduleUpsert } from '../types';

interface HyperliquidFeeResponse {
  userAddRate?: number | string;
  userCrossRate?: number | string;
}

const isFeeRate = (value: unknown): value is number | string =>
  typeof value === 'number' || typeof value === 'string';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isHyperliquidFeeResponse = (value: unknown): value is HyperliquidFeeResponse =>
  isRecord(value) && isFeeRate(value.userAddRate) && isFeeRate(value.userCrossRate);

export interface HyperliquidFeeFetcherOptions {
  baseUrl?: string;
  timestamp?: number;
  user?: string;
}

export const fetchHyperliquidFees = async (
  options: HyperliquidFeeFetcherOptions = {},
): Promise<FeeScheduleUpsert[]> => {
  const ts = options.timestamp ?? Date.now();
  const url = options.baseUrl ?? 'https://api.hyperliquid.xyz/info';
  if (!options.user) {
    throw new Error('Hyperliquid fee sync requires a wallet address');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'userFees', user: options.user }),
  });
  if (!res.ok) {
    const reason = (await res.text()).trim() || res.statusText;
    throw new Error(`Hyperliquid fee request failed (${res.status}): ${reason}`);
  }
  const data: unknown = await res.json();
  if (!isHyperliquidFeeResponse(data)) {
    throw new Error('Hyperliquid fee response did not contain valid maker and taker fees');
  }
  const maker = Number(data.userAddRate);
  const taker = Number(data.userCrossRate);
  if (!Number.isFinite(maker) || !Number.isFinite(taker)) {
    throw new Error('Hyperliquid fee response did not contain valid maker and taker fees');
  }
  return [
    {
      exchangeCode: 'hyperliquid',
      symbol: '*',
      productType: 'PERP',
      makerBps: maker * 10_000,
      takerBps: taker * 10_000,
      effectiveFrom: Math.floor(ts / 1000),
      source: 'hyperliquid:userFees',
    } satisfies FeeScheduleUpsert,
  ];
};
