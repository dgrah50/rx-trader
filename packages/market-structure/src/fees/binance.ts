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

const BINANCE_DEFAULT_FEES = { makerBps: 10, takerBps: 10 };

export const fetchBinanceFees = async (
  options: BinanceFeeFetcherOptions
): Promise<FeeScheduleUpsert[]> => {
  const productType = options.productType ?? 'SPOT';
  const ts = options.timestamp ?? Date.now();
  if (!options.apiKey || !options.apiSecret) {
    return [buildDefault('binance', '*', productType, ts)];
  }
  const baseUrl = options.baseUrl ?? 'https://api.binance.com';
  const params = new URLSearchParams({ timestamp: String(ts) });
  const signature = createHmac('sha256', options.apiSecret)
    .update(params.toString())
    .digest('hex');
  params.set('signature', signature);
  const res = await fetch(`${baseUrl}/sapi/v1/asset/tradeFee?${params.toString()}`, {
    headers: { 'X-MBX-APIKEY': options.apiKey }
  });
  if (!res.ok) {
    return [buildDefault('binance', '*', productType, ts)];
  }
  const json = (await res.json()) as BinanceTradeFeeResponse[];
  return json.map((entry) => {
    const makerBps = Number(entry.makerCommission) * 10_000;
    const takerBps = Number(entry.takerCommission) * 10_000;
    return {
      exchangeCode: 'binance',
      symbol: entry.symbol,
      productType,
      makerBps: Number.isFinite(makerBps) ? makerBps : BINANCE_DEFAULT_FEES.makerBps,
      takerBps: Number.isFinite(takerBps) ? takerBps : BINANCE_DEFAULT_FEES.takerBps,
      effectiveFrom: Math.floor(ts / 1000),
      source: 'binance:sapi'
    } satisfies FeeScheduleUpsert;
  });
};

const buildDefault = (
  exchangeCode: string,
  symbol: string,
  productType: string,
  ts: number
): FeeScheduleUpsert => ({
  exchangeCode,
  symbol,
  productType,
  makerBps: BINANCE_DEFAULT_FEES.makerBps,
  takerBps: BINANCE_DEFAULT_FEES.takerBps,
  effectiveFrom: Math.floor(ts / 1000),
  source: 'default'
});
