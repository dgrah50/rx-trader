import { ExecutionVenue } from './constants';

const QUOTE_ASSETS = ['USDT', 'USD', 'USDC', 'BTC', 'ETH', 'BNB', 'EUR', 'JPY'] as const;

export interface SymbolAssets {
  base: string;
  quote: string;
}

export const splitSymbolAssets = (symbol: string): SymbolAssets | null => {
  const upper = symbol.toUpperCase();
  const quote = QUOTE_ASSETS.find(
    (candidate) => upper.endsWith(candidate) && upper.length > candidate.length,
  );
  return quote ? { base: upper.slice(0, -quote.length), quote } : null;
};

export const detectExecutionVenue = (
  value: string | null | undefined,
): ExecutionVenue | undefined => {
  const lower = value?.toLowerCase() ?? '';
  if (lower.includes(ExecutionVenue.Binance)) return ExecutionVenue.Binance;
  if (lower.includes(ExecutionVenue.Hyperliquid)) return ExecutionVenue.Hyperliquid;
  if (lower.includes(ExecutionVenue.Paper)) return ExecutionVenue.Paper;
  return undefined;
};

export const normalizeExecutionVenue = (value: string | null | undefined): string =>
  detectExecutionVenue(value) ?? value ?? ExecutionVenue.Paper;
