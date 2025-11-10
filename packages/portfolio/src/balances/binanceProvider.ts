import { BalanceProvider, BalanceSnapshot } from './types';
import { createHmac } from 'node:crypto';

interface BinanceBalanceProviderConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
}

export class BinanceBalanceProvider implements BalanceProvider {
  public readonly venue = 'binance';
  private readonly baseUrl: string;

  constructor(private readonly config: BinanceBalanceProviderConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.binance.com';
  }

  async sync(): Promise<BalanceSnapshot[]> {
    const timestamp = Date.now();
    const params = new URLSearchParams({ timestamp: String(timestamp) });
    this.sign(params);
    const url = `${this.baseUrl}/sapi/v3/account?${params.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': this.config.apiKey
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Binance balance sync failed: ${response.status} ${body}`);
    }
    const payload = (await response.json()) as { balances: Array<{ asset: string; free: string; locked: string }> };
    return (payload.balances ?? [])
      .filter((bal) => Number(bal.free) !== 0 || Number(bal.locked) !== 0)
      .map((bal) => ({
        venue: this.venue,
        asset: bal.asset,
        available: Number(bal.free),
        locked: Number(bal.locked)
      }));
  }

  stop() {
    // nothing to clean up
  }

  private sign(params: URLSearchParams) {
    const signature = createHmac('sha256', this.config.apiSecret)
      .update(params.toString())
      .digest('hex');
    params.set('signature', signature);
  }
}
