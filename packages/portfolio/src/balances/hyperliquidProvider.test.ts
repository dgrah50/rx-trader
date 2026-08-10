import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { HyperliquidBalanceProvider } from './hyperliquidProvider';

describe('HyperliquidBalanceProvider', () => {
  const fetchMock = vi.fn();
  const originalFetch = global.fetch;
  beforeEach(() => {
    fetchMock.mockReset();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch as any;
  });

  it('parses balances payload into snapshots', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        balances: [
          { coin: 'USDC', total: '123.45', hold: '3.45' },
          { coin: 'BTC', total: '0.3', hold: '0.2' },
        ],
      }),
    } as any);

    const provider = new HyperliquidBalanceProvider({ walletAddress: '0xabc' });
    const snapshots = await provider.sync();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.hyperliquid.xyz/info',
      expect.objectContaining({
        body: JSON.stringify({ type: 'spotClearinghouseState', user: '0xabc' }),
      }),
    );
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({ asset: 'USDC', available: 120 });
    expect(snapshots[1]).toMatchObject({ asset: 'BTC', locked: 0.2 });
    expect(snapshots[1]?.available).toBeCloseTo(0.1);
  });

  it('throws when response is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'oops' } as any);
    const provider = new HyperliquidBalanceProvider({ walletAddress: '0xabc' });
    await expect(provider.sync()).rejects.toThrow('Hyperliquid balance sync failed');
  });
});
