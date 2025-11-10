import type { Observable, Subscription } from 'rxjs';
import type { MarketTick } from '@rx-trader/core';
import type { BalanceProvider, BalanceSnapshot } from './types';

interface MockBalanceProviderOptions {
  venue: string;
  baseAsset: string;
  quoteAsset: string;
  marks$?: Observable<MarketTick>;
  fallbackPrice?: number;
}

export class MockBalanceProvider implements BalanceProvider {
  public readonly venue: string;
  private latestPrice: number;
  private readonly baseAsset: string;
  private readonly quoteAsset: string;
  private readonly subscription?: Subscription;

  constructor(options: MockBalanceProviderOptions) {
    this.venue = options.venue;
    this.baseAsset = options.baseAsset;
    this.quoteAsset = options.quoteAsset;
    this.latestPrice = options.fallbackPrice ?? 100;
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
    const price = this.latestPrice || 100;
    const volatility = Math.abs(Math.sin(price / 10_000)) + 0.1;
    const baseTotal = Number((volatility * 0.75).toFixed(4));
    const baseLocked = Number((baseTotal * 0.1).toFixed(4));
    const quoteTotal = Number((baseTotal * price * 3).toFixed(2));
    const quoteLocked = Number((quoteTotal * 0.05).toFixed(2));
    return [
      {
        venue: this.venue,
        asset: this.baseAsset,
        available: baseTotal - baseLocked,
        locked: baseLocked
      },
      {
        venue: this.venue,
        asset: this.quoteAsset,
        available: quoteTotal - quoteLocked,
        locked: quoteLocked
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
