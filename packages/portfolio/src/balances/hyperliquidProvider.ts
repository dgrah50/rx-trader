import type { BalanceProvider, BalanceSnapshot } from './types';

interface HyperliquidBalanceProviderConfig {
  walletAddress: string;
  subaccount?: number;
  baseUrl?: string;
}

interface HyperliquidBalanceEntry {
  coin?: string;
  asset?: string;
  total?: string | number;
  balance?: string | number;
  available?: string | number;
  free?: string | number;
  locked?: string | number;
}

export class HyperliquidBalanceProvider implements BalanceProvider {
  public readonly venue = 'hyperliquid';
  private readonly baseUrl: string;

  constructor(private readonly config: HyperliquidBalanceProviderConfig) {
    if (!config.walletAddress) {
      throw new Error('Hyperliquid walletAddress is required');
    }
    this.baseUrl = config.baseUrl ?? 'https://api.hyperliquid.xyz';
  }

  async sync(): Promise<BalanceSnapshot[]> {
    const response = await fetch(`${this.baseUrl}/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'balances',
        params: {
          address: this.config.walletAddress,
          subAccount: this.config.subaccount ?? 0
        }
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Hyperliquid balance sync failed: ${response.status} ${text}`);
    }
    const payload = await response.json();
    const entries = extractEntries(payload);
    return entries.map((entry) => {
      const total = toNumber(entry.total ?? entry.balance ?? entry.free ?? entry.available ?? 0);
      const available = toNumber(entry.available ?? entry.free ?? total);
      const locked = toNumber(entry.locked ?? Math.max(0, total - available));
      const asset = (entry.coin ?? entry.asset ?? 'USD').toUpperCase();
      return {
        venue: this.venue,
        asset,
        available,
        locked
      } satisfies BalanceSnapshot;
    });
  }

  stop() {
    // no-op
  }
}

const extractEntries = (payload: any): HyperliquidBalanceEntry[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.balances)) return payload.balances;
  if (Array.isArray(payload?.spotBalances)) return payload.spotBalances;
  if (Array.isArray(payload?.result?.balances)) return payload.result.balances;
  return [];
};

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
};
