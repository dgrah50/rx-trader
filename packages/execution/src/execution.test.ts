import { describe, expect, it, vi, afterEach } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import {
  PaperExecutionAdapter,
  BinanceMockGateway,
  HyperliquidMockGateway,
  BinanceRestGateway,
  HyperliquidRestGateway
} from './index';
import { ExecutionVenue } from '@rx-trader/core/constants';
import { createManualClock } from '@rx-trader/core/time';

const order = {
  id: 'order-1',
  t: 0,
  symbol: 'SIM',
  side: 'BUY' as const,
  qty: 1,
  type: 'MKT' as const,
  tif: 'DAY' as const,
  account: 'TEST'
};

describe('PaperExecutionAdapter', () => {
  it('emits ack and fill events for submitted orders', async () => {
    const clock = createManualClock(1);
    const adapter = new PaperExecutionAdapter(ExecutionVenue.Paper, clock);
    const eventsPromise = firstValueFrom(adapter.events$.pipe(take(2), toArray()));

    await adapter.submit(order);
    const events = await eventsPromise;

    expect(events[0]?.type).toBe('order.ack');
    expect(events[1]?.type).toBe('order.fill');
    expect(events[0]?.ts).toBe(1);
    expect(events[1]?.ts).toBe(1);
  });
});

describe('BinanceMockGateway', () => {
  it('emits ack and fill', async () => {
    const clock = createManualClock(5);
    const adapter = new BinanceMockGateway(ExecutionVenue.Binance, clock);
    const events = firstValueFrom(adapter.events$.pipe(take(2), toArray()));
    await adapter.submit(order);
    const [ack, fill] = (await events) as any[];
    expect(ack?.type).toBe('order.ack');
    expect(fill?.type).toBe('order.fill');
    expect(ack?.ts).toBe(5);
    expect(fill?.ts).toBe(10);
  });
});

describe('HyperliquidMockGateway', () => {
  it('emits ack and fill with slippage', async () => {
    const clock = createManualClock(10);
    const adapter = new HyperliquidMockGateway(ExecutionVenue.Hyperliquid, clock);
    const events = firstValueFrom(adapter.events$.pipe(take(2), toArray()));
    await adapter.submit(order);
    const [, fill] = (await events) as any[];
    expect(fill?.data.px).toBeDefined();
    expect(fill?.ts).toBe(20);
  });
});

describe('BinanceRestGateway', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits signed orders to Binance REST API', async () => {
    const clock = createManualClock(20);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ status: 'FILLED', price: '101', transactTime: 1 }), { status: 200 }));
    const adapter = new BinanceRestGateway({ apiKey: 'key', apiSecret: 'secret', baseUrl: 'https://example.com' }, clock);
    const events = firstValueFrom(adapter.events$.pipe(take(2), toArray()));
    await adapter.submit(order);
    const [, fill] = (await events) as any[];
    expect(fetchMock).toHaveBeenCalled();
    expect(fill?.data.px).toBe(101);
  });
});

describe('HyperliquidRestGateway', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits signed JSON payloads', async () => {
    const clock = createManualClock(30);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ status: 'filled', price: 99, timestamp: 2 }), { status: 200 }));
    const adapter = new HyperliquidRestGateway({ apiKey: 'key', apiSecret: 'secret', baseUrl: 'https://example.com' }, clock);
    const events = firstValueFrom(adapter.events$.pipe(take(2), toArray()));
    await adapter.submit(order);
    await events;
    expect(fetchMock).toHaveBeenCalled();
  });
});
