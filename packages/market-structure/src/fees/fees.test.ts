import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBinanceFees } from './binance';
import { fetchHyperliquidFees } from './hyperliquid';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchBinanceFees', () => {
  it('requires credentials instead of fabricating a default schedule', async () => {
    await expect(fetchBinanceFees({})).rejects.toThrow(
      'requires both an API key and API secret'
    );
  });

  it('rejects venue errors instead of returning a successful default entry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('invalid signature', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(
      fetchBinanceFees({ apiKey: 'key', apiSecret: 'secret', baseUrl: 'https://example.test' })
    ).rejects.toThrow('Binance fee request failed (401): invalid signature');
  });

  it('rejects malformed fee entries', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { symbol: 'BTCUSDT', makerCommission: 'not-a-number', takerCommission: '0.0005' }
        ]),
        { status: 200 }
      )
    );

    await expect(
      fetchBinanceFees({ apiKey: 'key', apiSecret: 'secret', baseUrl: 'https://example.test' })
    ).rejects.toThrow('invalid fee entry for BTCUSDT');
  });
});

describe('fetchHyperliquidFees', () => {
  it('returns validated venue fees', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ userAddRate: '-0.0002', userCrossRate: '0.0005' }),
        { status: 200 }
      )
    );

    const [entry] = await fetchHyperliquidFees({
      baseUrl: 'https://example.test',
      user: '0x0000000000000000000000000000000000000000',
      timestamp: 2_000
    });

    expect(entry).toMatchObject({
      makerBps: -2,
      takerBps: 5,
      effectiveFrom: 2,
      source: 'hyperliquid:userFees'
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test',
      expect.objectContaining({
        body: JSON.stringify({
          type: 'userFees',
          user: '0x0000000000000000000000000000000000000000'
        })
      })
    );
  });

  it('rejects responses without fees instead of fabricating a default schedule', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );

    await expect(
      fetchHyperliquidFees({
        baseUrl: 'https://example.test',
        user: '0x0000000000000000000000000000000000000000'
      })
    ).rejects.toThrow('did not contain valid maker and taker fees');
  });

  it('requires a wallet address instead of requesting unrelated market metadata', async () => {
    await expect(fetchHyperliquidFees()).rejects.toThrow('requires a wallet address');
  });
});
