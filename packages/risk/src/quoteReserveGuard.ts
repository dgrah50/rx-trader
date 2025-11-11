import type { BalanceEntry } from '@rx-trader/core/domain';
import type { AccountExposureGuard } from './preTrade';

interface QuoteReserveGuardOptions {
  venue: string;
  baseAsset: string;
  quoteAsset: string;
  getBalance: (venue: string, asset: string) => BalanceEntry | undefined;
}

export class QuoteReserveGuard implements AccountExposureGuard {
  public readonly venue: string;
  public readonly baseAsset: string;
  public readonly quoteAsset: string;
  private readonly getBalanceInternal: QuoteReserveGuardOptions['getBalance'];
  private readonly pending = new Map<string, number>();
  private pendingTotal = 0;

  constructor(options: QuoteReserveGuardOptions) {
    this.venue = options.venue;
    this.baseAsset = options.baseAsset;
    this.quoteAsset = options.quoteAsset;
    this.getBalanceInternal = options.getBalance;
  }

  getAvailable = (venue: string, asset: string): number | null => {
    const entry = this.getBalanceInternal(venue, asset);
    if (venue === this.venue && asset === this.quoteAsset) {
      const available = entry?.available ?? 0;
      return available - this.pendingTotal;
    }
    if (venue === this.venue && asset === this.baseAsset) {
      return entry?.available ?? 0;
    }
    return entry?.available ?? null;
  };

  reserve = (orderId: string, amount: number) => {
    if (!amount || amount <= 0) return;
    const existing = this.pending.get(orderId) ?? 0;
    const next = existing + amount;
    this.pending.set(orderId, next);
    this.pendingTotal += amount;
  };

  consume = (orderId: string, amount: number) => {
    if (!amount || amount <= 0) return;
    const existing = this.pending.get(orderId);
    if (existing === undefined) return;
    const delta = Math.min(existing, amount);
    const next = existing - delta;
    if (next <= 1e-6) {
      this.pending.delete(orderId);
    } else {
      this.pending.set(orderId, next);
    }
    this.pendingTotal = Math.max(0, this.pendingTotal - delta);
  };

  release = (orderId: string) => {
    const amount = this.pending.get(orderId);
    if (amount === undefined) return;
    this.pending.delete(orderId);
    this.pendingTotal = Math.max(0, this.pendingTotal - amount);
  };

  inspect = () => ({
    pendingTotal: this.pendingTotal,
    pending: Array.from(this.pending.entries()).map(([orderId, amount]) => ({ orderId, amount }))
  });
}

export const createQuoteReserveGuard = (options: QuoteReserveGuardOptions) => {
  return new QuoteReserveGuard(options);
};
