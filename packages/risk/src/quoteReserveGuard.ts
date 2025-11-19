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
  // Track pending base asset from BUY fills not yet processed
  private readonly pendingBaseAdds = new Map<string, number>();
  private pendingBaseAddsTotal = 0;

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
      // Add pending base asset from BUY orders that will fill
      return (entry?.available ?? 0) + this.pendingBaseAddsTotal;
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

  // Track base asset pending from BUY orders
  reserveBase = (orderId: string, qty: number) => {
    if (!qty || qty <= 0) return;
    const existing = this.pendingBaseAdds.get(orderId) ?? 0;
    const next = existing + qty;
    this.pendingBaseAdds.set(orderId, next);
    this.pendingBaseAddsTotal += qty;
  };

  // Release base asset reservation when fill is processed
  releaseBase = (orderId: string) => {
    const qty = this.pendingBaseAdds.get(orderId);
    if (qty === undefined) return;
    this.pendingBaseAdds.delete(orderId);
    this.pendingBaseAddsTotal = Math.max(0, this.pendingBaseAddsTotal - qty);
  };

  inspect = () => ({
    pendingTotal: this.pendingTotal,
    pending: Array.from(this.pending.entries()).map(([orderId, amount]) => ({ orderId, amount })),
    pendingBaseAddsTotal: this.pendingBaseAddsTotal,
    pendingBaseAdds: Array.from(this.pendingBaseAdds.entries()).map(([orderId, qty]) => ({ orderId, qty }))
  });
}

export const createQuoteReserveGuard = (options: QuoteReserveGuardOptions) => {
  return new QuoteReserveGuard(options);
};
