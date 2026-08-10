import { type MarketTick, parseFiniteNumber } from '@rx-trader/core';
import { WebSocketFeed, type WebSocketFeedOptions } from './websocketFeed';

export type BinanceStream = 'bookTicker' | 'ticker';

export interface BinanceFeedConfig extends WebSocketFeedOptions {
  symbol: string;
  stream?: BinanceStream;
  baseUrl?: string;
}

type BinanceBookTickerEvent = {
  s?: string;
  b: string;
  B: string;
  a: string;
  A: string;
  c?: string;
  E?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isBinanceBookTickerEvent = (value: unknown): value is BinanceBookTickerEvent =>
  isRecord(value) &&
  typeof value.b === 'string' &&
  typeof value.B === 'string' &&
  typeof value.a === 'string' &&
  typeof value.A === 'string' &&
  (value.s === undefined || typeof value.s === 'string') &&
  (value.c === undefined || typeof value.c === 'string') &&
  (value.E === undefined || typeof value.E === 'number');

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

    const symbol = (payload.s ?? this.symbol).toUpperCase();

    return {
      t: payload.E ?? Date.now(),
      symbol,
      bid: parseFiniteNumber(payload.b),
      ask: parseFiniteNumber(payload.a),
      last: parseFiniteNumber(payload.c ?? payload.a),
      bidSz: parseFiniteNumber(payload.B),
      askSz: parseFiniteNumber(payload.A)
    };
  }

  private unwrap(message: unknown): BinanceBookTickerEvent | null {
    if (!isRecord(message)) {
      return null;
    }
    if ('data' in message) {
      return isBinanceBookTickerEvent(message.data) ? message.data : null;
    }
    return isBinanceBookTickerEvent(message) ? message : null;
  }
}
