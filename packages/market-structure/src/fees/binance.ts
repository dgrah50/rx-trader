import { createHmac } from 'node:crypto';
import type { FeeScheduleUpsert } from '../types';

export interface BinanceFeeFetcherOptions {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  productType?: string;
  timestamp?: number;
}

interface BinanceTradeFeeResponse {
  symbol: string;
  makerCommission: string;
  takerCommission: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBinanceTradeFee = (value: unknown): value is BinanceTradeFeeResponse =>
  isRecord(value) &&
  typeof value.symbol === 'string' &&
  typeof value.makerCommission === 'string' &&
  typeof value.takerCommission === 'string';

export const fetchBinanceFees = async (
  options: BinanceFeeFetcherOptions,
): Promise<FeeScheduleUpsert[]> => {
  const productType = options.productType ?? 'SPOT';
  const ts = options.timestamp ?? Date.now();
  if (!options.apiKey || !options.apiSecret) {
    throw new Error('Binance fee sync requires both an API key and API secret');
  }
  const baseUrl = options.baseUrl ?? 'https://api.binance.com';
  const params = new URLSearchParams({ timestamp: String(ts) });
  const signature = createHmac('sha256', options.apiSecret).update(params.toString()).digest('hex');
  params.set('signature', signature);
  const res = await fetch(`${baseUrl}/sapi/v1/asset/tradeFee?${params.toString()}`, {
    headers: { 'X-MBX-APIKEY': options.apiKey },
  });
  if (!res.ok) {
    const reason = (await res.text()).trim() || res.statusText;
    throw new Error(`Binance fee request failed (${res.status}): ${reason}`);
  }
  const json: unknown = await res.json();
  if (!Array.isArray(json) || !json.every(isBinanceTradeFee)) {
    throw new Error('Binance returned an invalid fee response');
  }
  return json.map((entry) => {
    const makerBps = Number(entry.makerCommission) * 10_000;
    const takerBps = Number(entry.takerCommission) * 10_000;
    if (!entry.symbol || !Number.isFinite(makerBps) || !Number.isFinite(takerBps)) {
      throw new Error(
        `Binance returned an invalid fee entry for ${entry.symbol || 'unknown symbol'}`,
      );
    }
    return {
      exchangeCode: 'binance',
      symbol: entry.symbol,
      productType,
      makerBps,
      takerBps,
      effectiveFrom: Math.floor(ts / 1000),
      source: 'binance:sapi',
    } satisfies FeeScheduleUpsert;
  });
};
