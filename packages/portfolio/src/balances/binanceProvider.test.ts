import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceBalanceProvider } from './binanceProvider';

describe('BinanceBalanceProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests signed spot account balances', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          balances: [
            { asset: 'USDT', free: '100', locked: '2' },
            { asset: 'BTC', free: '0', locked: '0' },
          ],
        }),
      ),
    );
    const provider = new BinanceBalanceProvider({
      apiKey: 'key',
      apiSecret: 'secret',
      baseUrl: 'https://example.com',
    });

    await expect(provider.sync()).resolves.toEqual([
      { venue: 'binance', asset: 'USDT', available: 100, locked: 2 },
    ]);

    const [requestUrl, request] = fetchMock.mock.calls[0]!;
    const url = new URL(String(requestUrl));
    expect(url.pathname).toBe('/api/v3/account');
    expect(url.searchParams.get('omitZeroBalances')).toBe('true');
    expect(url.searchParams.get('timestamp')).not.toBeNull();
    expect(url.searchParams.get('signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(request?.headers).toEqual({ 'X-MBX-APIKEY': 'key' });
  });
});
