import type { MarketTick } from '@rx-trader/core';
import { WebSocketFeed, type WebSocketFeedOptions } from './websocketFeed';

export type BinanceStream = 'bookTicker' | 'ticker';

export interface BinanceFeedConfig extends WebSocketFeedOptions {
  symbol: string;
  stream?: BinanceStream;
  baseUrl?: string;
}

type BinanceBookTickerEvent = {
  s: string;
  b: string;
  B: string;
  a: string;
  A: string;
  c?: string;
  E?: number;
};

type BinanceCombinedStream = {
  stream: string;
  data: BinanceBookTickerEvent;
};

export class BinanceFeedAdapter extends WebSocketFeed {
  private readonly symbol: string;
  private readonly stream: BinanceStream;
  private readonly baseUrl: string;

  constructor(config: BinanceFeedConfig) {
    const id = `binance:${config.symbol}:${config.stream ?? 'bookTicker'}`;
    super(id, config);
    this.symbol = config.symbol;
    this.stream = config.stream ?? 'bookTicker';
    this.baseUrl = config.baseUrl ?? 'wss://stream.binance.com:9443/ws';
  }

  protected createUrl(): string {
    const normalized = this.symbol.toLowerCase();
    const streamName =
      this.stream === 'ticker' ? `${normalized}@ticker` : `${normalized}@bookTicker`;
    return `${this.baseUrl}/${streamName}`;
  }

  protected mapMessage(message: unknown): MarketTick | null {
    const payload = this.unwrap(message);
    if (!payload) {
      return null;
    }

    if (!('b' in payload) || !('a' in payload)) {
      return null;
    }

    const event = payload as BinanceBookTickerEvent;
    const symbol = (event.s ?? this.symbol).toUpperCase();

    return {
      t: typeof event.E === 'number' ? event.E : Date.now(),
      symbol,
      bid: this.toNumber(event.b),
      ask: this.toNumber(event.a),
      last: this.toNumber(event.c ?? event.a ?? event.b),
      bidSz: this.toNumber(event.B),
      askSz: this.toNumber(event.A)
    };
  }

  private unwrap(message: unknown): BinanceBookTickerEvent | null {
    if (!message || typeof message !== 'object') {
      return null;
    }
    if ('data' in message) {
      const combined = message as BinanceCombinedStream;
      return combined.data ?? null;
    }
    return message as BinanceBookTickerEvent;
  }

  private toNumber(value?: string | number): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : undefined;
  }
}
