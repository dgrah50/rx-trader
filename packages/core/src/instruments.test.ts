import { describe, expect, it } from 'vitest';
import { ExecutionVenue } from './constants';
import {
  detectExecutionVenue,
  normalizeExecutionVenue,
  splitSymbolAssets,
} from './instruments';

describe('splitSymbolAssets', () => {
  it('splits supported quote assets and normalizes case', () => {
    expect(splitSymbolAssets('ethusdt')).toEqual({ base: 'ETH', quote: 'USDT' });
    expect(splitSymbolAssets('ETHBTC')).toEqual({ base: 'ETH', quote: 'BTC' });
  });

  it('does not invent a split for an unsupported or empty symbol', () => {
    expect(splitSymbolAssets('UNKNOWN')).toBeNull();
    expect(splitSymbolAssets('')).toBeNull();
  });

  it('requires a non-empty base asset', () => {
    expect(splitSymbolAssets('USDT')).toBeNull();
  });
});

describe('detectExecutionVenue', () => {
  it('detects venue names case-insensitively inside adapter identifiers', () => {
    expect(detectExecutionVenue('BINANCE-live')).toBe(ExecutionVenue.Binance);
    expect(detectExecutionVenue('historical:hyperliquid')).toBe(ExecutionVenue.Hyperliquid);
    expect(detectExecutionVenue('paper-demo')).toBe(ExecutionVenue.Paper);
  });

  it('leaves unknown and missing venue fallback policy to the caller', () => {
    expect(detectExecutionVenue('custom-venue')).toBeUndefined();
    expect(detectExecutionVenue(null)).toBeUndefined();
    expect(detectExecutionVenue(undefined)).toBeUndefined();
  });
});

describe('normalizeExecutionVenue', () => {
  it('normalizes recognized adapters while preserving custom venue identifiers', () => {
    expect(normalizeExecutionVenue('BINANCE-live')).toBe(ExecutionVenue.Binance);
    expect(normalizeExecutionVenue('Custom-Venue')).toBe('Custom-Venue');
  });

  it('defaults missing venue identifiers to paper', () => {
    expect(normalizeExecutionVenue(undefined)).toBe(ExecutionVenue.Paper);
    expect(normalizeExecutionVenue(null)).toBe(ExecutionVenue.Paper);
  });
});
