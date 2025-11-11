import type { Observable, Subscription } from 'rxjs';
import type { MarketTick } from '@rx-trader/core';
import type { BalanceProvider, BalanceSnapshot } from './types';

interface MockBalanceProviderOptions {
  venue: string;
  baseAsset: string;
  quoteAsset: string;
  marks$?: Observable<MarketTick>;
  fallbackPrice?: number;
  initialBase?: number;
  initialQuote?: number;
}

export class MockBalanceProvider implements BalanceProvider {
  public readonly venue: string;
  private latestPrice: number;
  private readonly baseAsset: string;
  private readonly quoteAsset: string;
  private readonly initialBase: number;
  private readonly initialQuote: number;
  private readonly subscription?: Subscription;

  constructor(options: MockBalanceProviderOptions) {
    this.venue = options.venue;
    this.baseAsset = options.baseAsset;
    this.quoteAsset = options.quoteAsset;
    this.latestPrice = options.fallbackPrice ?? 100;
    this.initialBase = Math.max(0, options.initialBase ?? 0);
    this.initialQuote = Math.max(0, options.initialQuote ?? 1000);
    if (options.marks$) {
      this.subscription = options.marks$.subscribe((tick) => {
        const px = pickPrice(tick);
        if (px && Number.isFinite(px)) {
          this.latestPrice = px;
        }
      });
    }
  }

  async sync(): Promise<BalanceSnapshot[]> {
    // Demo-friendly deterministic balances. Start with a fixed quote stash and flat base.
    // Fills will move these via accounting events; subsequent syncs should only correct drift.
    const baseTotal = this.initialBase;
    const quoteTotal = this.initialQuote;
    return [
      {
        venue: this.venue,
        asset: this.baseAsset,
        available: baseTotal,
        locked: 0
      },
      {
        venue: this.venue,
        asset: this.quoteAsset,
        available: quoteTotal,
        locked: 0
      }
    ];
  }

  stop() {
    this.subscription?.unsubscribe();
  }
}

const pickPrice = (tick: MarketTick) => {
  if (typeof tick.last === 'number') return tick.last;
  if (typeof tick.ask === 'number' && typeof tick.bid === 'number') {
    return (tick.ask + tick.bid) / 2;
  }
  if (typeof tick.ask === 'number') return tick.ask;
  if (typeof tick.bid === 'number') return tick.bid;
  return undefined;
};
