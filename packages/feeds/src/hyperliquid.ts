import type { MarketTick } from '@rx-trader/core';
import { WebSocketFeed, type WebSocketFeedOptions } from './websocketFeed';

type HyperliquidSubscriptionType = 'bbo' | 'l2Book' | 'trades';

export interface HyperliquidFeedConfig extends WebSocketFeedOptions {
  coin: string;
  subscriptionType?: HyperliquidSubscriptionType;
  baseUrl?: string;
}

interface HyperliquidSubscriptionResponse {
  channel: string;
  data: unknown;
}

interface HyperliquidBboData {
  coin: string;
  time: number;
  bbo: [HyperliquidLevel | null, HyperliquidLevel | null];
}

interface HyperliquidLevel {
  px: string | number;
  sz: string | number;
  n?: number;
}

interface HyperliquidTrade {
  coin: string;
  px: string | number;
  sz: string | number;
  side?: string;
  time: number;
}

export class HyperliquidFeedAdapter extends WebSocketFeed {
  private readonly coin: string;
  private readonly subscriptionType: HyperliquidSubscriptionType;
  private readonly baseUrl: string;

  constructor(config: HyperliquidFeedConfig) {
    const id = `hyperliquid:${config.coin}:${config.subscriptionType ?? 'bbo'}`;
    super(id, config);
    this.coin = config.coin;
    this.subscriptionType = config.subscriptionType ?? 'bbo';
    this.baseUrl = config.baseUrl ?? 'wss://api.hyperliquid.xyz/ws';
  }

  protected createUrl(): string {
    return this.baseUrl;
  }

  protected createSubscribePayload(): string | undefined {
    return JSON.stringify({
      method: 'subscribe',
      subscription: {
        type: this.subscriptionType,
        coin: this.coin
      }
    });
  }

  protected mapMessage(message: unknown): MarketTick | null {
    if (!message || typeof message !== 'object' || message === null) {
      return null;
    }
    if (!('channel' in message)) {
      return null;
    }
    return this.handleStructuredMessage(message as HyperliquidSubscriptionResponse);
  }

  private handleStructuredMessage(payload: HyperliquidSubscriptionResponse): MarketTick | null {
    if (payload.channel === 'subscriptionResponse') {
      return null;
    }
    if (payload.channel === this.subscriptionType && payload.data) {
      if (this.subscriptionType === 'bbo') {
        return this.mapBbo(payload.data as HyperliquidBboData);
      }
      if (this.subscriptionType === 'trades') {
        return this.mapTrades(payload.data as HyperliquidTrade[] | HyperliquidTrade);
      }
    }
    return null;
  }

  private mapBbo(data: HyperliquidBboData): MarketTick | null {
    const bid = this.toLevel(data.bbo?.[0] ?? null);
    const ask = this.toLevel(data.bbo?.[1] ?? null);
    if (!bid && !ask) {
      return null;
    }
    const bidPx = bid?.px;
    const askPx = ask?.px;
    let last: number | undefined;
    if (bidPx !== undefined && askPx !== undefined) {
      last = (bidPx + askPx) / 2;
    } else {
      last = bidPx ?? askPx;
    }
    return {
      t: typeof data.time === 'number' ? data.time : Date.now(),
      symbol: (data.coin ?? this.coin).toUpperCase(),
      last,
      bid: bidPx,
      bidSz: bid?.sz,
      ask: askPx,
      askSz: ask?.sz
    };
  }

  private toLevel(level: HyperliquidLevel | null) {
    if (!level) return null;
    const px = this.toNumber(level.px);
    const sz = this.toNumber(level.sz);
    if (px === undefined && sz === undefined) return null;
    return { px, sz };
  }

  private mapTrades(data: HyperliquidTrade[] | HyperliquidTrade): MarketTick | null {
    const trade = Array.isArray(data) ? data[data.length - 1] : data;
    if (!trade) return null;
    const px = this.toNumber(trade.px);
    if (px === undefined) return null;
    return {
      t: typeof trade.time === 'number' ? trade.time : Date.now(),
      symbol: (trade.coin ?? this.coin).toUpperCase(),
      last: px
    };
  }

  private toNumber(value?: string | number): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : undefined;
  }
}
