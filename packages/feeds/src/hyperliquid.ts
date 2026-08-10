import { type MarketTick, parseFiniteNumber } from '@rx-trader/core';
import { WebSocketFeed, type WebSocketFeedOptions } from './websocketFeed';

type HyperliquidSubscriptionType = 'bbo' | 'l2Book' | 'trades';

export interface HyperliquidFeedConfig extends WebSocketFeedOptions {
  coin: string;
  subscriptionType?: HyperliquidSubscriptionType;
  baseUrl?: string;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isHyperliquidLevel = (value: unknown): value is HyperliquidLevel =>
  isRecord(value) &&
  (typeof value.px === 'string' || typeof value.px === 'number') &&
  (typeof value.sz === 'string' || typeof value.sz === 'number');

const isHyperliquidBboData = (value: unknown): value is HyperliquidBboData =>
  isRecord(value) &&
  typeof value.coin === 'string' &&
  typeof value.time === 'number' &&
  Array.isArray(value.bbo) &&
  value.bbo.length === 2 &&
  value.bbo.every((level) => level === null || isHyperliquidLevel(level));

const isHyperliquidTrade = (value: unknown): value is HyperliquidTrade =>
  isRecord(value) &&
  typeof value.coin === 'string' &&
  typeof value.time === 'number' &&
  (typeof value.px === 'string' || typeof value.px === 'number') &&
  (typeof value.sz === 'string' || typeof value.sz === 'number');

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
    if (!isRecord(message) || typeof message.channel !== 'string') {
      return null;
    }
    if (message.channel === 'subscriptionResponse') {
      return null;
    }
    if (message.channel === this.subscriptionType) {
      if (this.subscriptionType === 'bbo') {
        return isHyperliquidBboData(message.data) ? this.mapBbo(message.data) : null;
      }
      if (this.subscriptionType === 'trades') {
        const trades = Array.isArray(message.data)
          ? message.data.every(isHyperliquidTrade)
            ? message.data
            : null
          : isHyperliquidTrade(message.data)
            ? message.data
            : null;
        return trades ? this.mapTrades(trades) : null;
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
    const px = parseFiniteNumber(level.px);
    const sz = parseFiniteNumber(level.sz);
    if (px === undefined && sz === undefined) return null;
    return { px, sz };
  }

  private mapTrades(data: HyperliquidTrade[] | HyperliquidTrade): MarketTick | null {
    const trade = Array.isArray(data) ? data[data.length - 1] : data;
    if (!trade) return null;
    const px = parseFiniteNumber(trade.px);
    if (px === undefined) return null;
    return {
      t: typeof trade.time === 'number' ? trade.time : Date.now(),
      symbol: (trade.coin ?? this.coin).toUpperCase(),
      last: px
    };
  }
}
