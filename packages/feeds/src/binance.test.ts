import { describe, expect, it, vi } from 'vitest';
import type { RawData } from 'ws';
import {
  BinanceFeedAdapter,
  type BinanceFeedConfig,
  type BinanceStream
} from './binance';
import type { WebSocketFactory, WebSocketLike } from './websocketFeed';

class MockWebSocket implements WebSocketLike {
  public readonly sent: string[] = [];
  public readyState = 1;
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};

  constructor(public readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit('close');
  }

  on(event: 'open' | 'message' | 'error' | 'close', listener: (...args: any[]) => void): this {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]?.push(listener);
    return this;
  }

  emit(event: string, data?: RawData | Error) {
    this.listeners[event]?.forEach((listener) => listener(data));
  }
}

const createFactory = (socket: MockWebSocket): WebSocketFactory => {
  return vi.fn(() => socket);
};

const mockMessage = {
  s: 'BTCUSDT',
  b: '100',
  B: '1.5',
  a: '101',
  A: '2.5',
  E: 1_700_000_000
};

describe('BinanceFeedAdapter', () => {
  it('streams normalized bookTicker ticks', () => {
    const socket = new MockWebSocket('ws://test');
    const factory = createFactory(socket);
    const stream: BinanceStream = 'bookTicker';
    const config: BinanceFeedConfig = { symbol: 'BTCUSDT', stream, webSocketFactory: factory };
    const adapter = new BinanceFeedAdapter(config);
    const ticks: any[] = [];
    adapter.feed$.subscribe((tick) => ticks.push(tick));

    adapter.connect();
    socket.emit('open');
    socket.emit('message', Buffer.from(JSON.stringify(mockMessage)));

    expect(factory).toHaveBeenCalled();
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 101,
      bidSz: 1.5,
      askSz: 2.5,
      t: mockMessage.E
    });
  });
});
