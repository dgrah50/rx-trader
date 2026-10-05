import { parseFiniteNumber } from '@rx-trader/core';
import type { BalanceProvider, BalanceSnapshot } from './types';

interface HyperliquidBalanceProviderConfig {
  walletAddress: string;
  subaccount?: number;
  baseUrl?: string;
}

interface HyperliquidBalanceEntry {
  coin: string;
  total: string;
  hold: string;
}

interface HyperliquidBalanceResponse {
  balances: HyperliquidBalanceEntry[];
}

export class HyperliquidBalanceProvider implements BalanceProvider {
  public readonly venue = 'hyperliquid';
  private readonly baseUrl: string;

  constructor(private readonly config: HyperliquidBalanceProviderConfig) {
    if (!config.walletAddress) {
      throw new Error('Hyperliquid walletAddress is required');
    }
    if (config.subaccount && config.subaccount !== 0) {
      throw new Error('Hyperliquid balance sync requires a subaccount address, not an index');
    }
    this.baseUrl = config.baseUrl ?? 'https://api.hyperliquid.xyz';
  }

  async sync(): Promise<BalanceSnapshot[]> {
    const response = await fetch(`${this.baseUrl}/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'spotClearinghouseState',
        user: this.config.walletAddress,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Hyperliquid balance sync failed: ${response.status} ${text}`);
    }
    const payload = (await response.json()) as HyperliquidBalanceResponse;
    return (payload.balances ?? []).map((entry) => {
      const total = parseFiniteNumber(entry.total) ?? 0;
      const locked = parseFiniteNumber(entry.hold) ?? 0;
      return {
        venue: this.venue,
        asset: entry.coin.toUpperCase(),
        available: total - locked,
        locked,
      } satisfies BalanceSnapshot;
    });
  }
}
