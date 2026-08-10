import { describe, expect, it, vi } from 'vitest';
import type { RawData } from 'ws';
import { HyperliquidFeedAdapter, type HyperliquidFeedConfig } from './hyperliquid';
import type { WebSocketFactory, WebSocketLike } from './websocketFeed';
import type { MarketTick } from '@rx-trader/core';

type SocketEventArgs = {
  open: [];
  message: [data: RawData];
  error: [error: Error];
  close: [];
};
type SocketEvent = keyof SocketEventArgs;

class MockWebSocket implements WebSocketLike {
  public readonly sent: string[] = [];
  public readyState = 1;
  private listeners: { [Event in SocketEvent]: Array<(...args: SocketEventArgs[Event]) => void> } = {
    open: [],
    message: [],
    error: [],
    close: []
  };

  constructor(public readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit('close');
  }

  on<Event extends SocketEvent>(event: Event, listener: (...args: SocketEventArgs[Event]) => void): this {
    this.listeners[event].push(listener);
    return this;
  }

  emit<Event extends SocketEvent>(event: Event, ...args: SocketEventArgs[Event]) {
    this.listeners[event].forEach((listener) => listener(...args));
  }
}

const createFactory = (socket: MockWebSocket): WebSocketFactory => vi.fn(() => socket);

describe('HyperliquidFeedAdapter', () => {
  it('subscribes and normalizes BBO payloads', () => {
    const socket = new MockWebSocket('ws://test');
    const factory = createFactory(socket);
    const config: HyperliquidFeedConfig = {
      coin: 'BTC',
      subscriptionType: 'bbo',
      webSocketFactory: factory
    };
    const adapter = new HyperliquidFeedAdapter(config);

    const ticks: MarketTick[] = [];
    adapter.feed$.subscribe((tick) => ticks.push(tick));

    adapter.connect();
    socket.emit('open');

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0] ?? '{}')).toEqual({
      method: 'subscribe',
      subscription: { type: 'bbo', coin: 'BTC' }
    });

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          channel: 'bbo',
          data: {
            coin: 'BTC',
            time: 1_700_000_000,
            bbo: [
              { px: '26499', sz: '10', n: 2 },
              { px: '26501', sz: '8', n: 3 }
            ]
          }
        })
      )
    );

    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({
      symbol: 'BTC',
      last: 26500,
      bid: 26499,
      ask: 26501,
      bidSz: 10,
      askSz: 8,
      t: 1_700_000_000
    });
  });

  it('normalizes trade payloads', () => {
    const socket = new MockWebSocket('ws://test');
    const factory = createFactory(socket);
    const config: HyperliquidFeedConfig = {
      coin: 'ETH',
      subscriptionType: 'trades',
      webSocketFactory: factory
    };
    const adapter = new HyperliquidFeedAdapter(config);
    const ticks: MarketTick[] = [];
    adapter.feed$.subscribe((tick) => ticks.push(tick));

    adapter.connect();
    socket.emit('open');

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          channel: 'trades',
          data: [
            { coin: 'ETH', px: '2500.5', sz: '1', side: 'B', time: 1_700_000_100 },
            { coin: 'ETH', px: '2501.2', sz: '0.5', side: 'S', time: 1_700_000_200 }
          ]
        })
      )
    );

    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({
      symbol: 'ETH',
      last: 2501.2,
      t: 1_700_000_200
    });
  });

  it('ignores malformed BBO and trade payloads', () => {
    const socket = new MockWebSocket('ws://test');
    const adapter = new HyperliquidFeedAdapter({
      coin: 'BTC',
      subscriptionType: 'bbo',
      webSocketFactory: createFactory(socket)
    });
    const ticks: MarketTick[] = [];
    adapter.feed$.subscribe((tick) => ticks.push(tick));

    adapter.connect();
    socket.emit('open');
    socket.emit(
      'message',
      Buffer.from(JSON.stringify({ channel: 'bbo', data: { coin: 'BTC', time: 1, bbo: {} } }))
    );

    expect(ticks).toEqual([]);
  });
});
