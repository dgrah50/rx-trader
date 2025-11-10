import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHyperliquidMarketStructure } from './hyperliquid';

describe('fetchHyperliquidMarketStructure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses meta response', async () => {
    const payload = {
      perpetuals: [
        { coin: 'BTC', szDecimals: 3, pxDecimals: 2, minSize: 0.001, enabled: true }
      ]
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload
    } as Response);

    const snapshot = await fetchHyperliquidMarketStructure('https://example.com');
    expect(snapshot.exchange.code).toBe('hyperliquid');
    expect(snapshot.exchangePairs[0]?.pairSymbol).toContain('BTC');
  });
});
