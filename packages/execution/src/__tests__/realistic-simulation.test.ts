import { describe, it, expect } from 'vitest';
import { PaperExecutionAdapter } from '../index';
import { systemClock } from '@rx-trader/core/time';
import type { OrderNew } from '@rx-trader/core/domain';

describe('PaperExecutionAdapter - Realistic Simulation', () => {
  it('adds latency to order execution', async () => {
    const adapter = new PaperExecutionAdapter('paper', systemClock);
    const fills: any[] = [];
    
    adapter.events$.subscribe((event) => {
      if (event.type === 'order.fill') {
        fills.push(event.data);
      }
    });

    const order: OrderNew = {
      id: 'test-1',
      t: Date.now(),
      symbol: 'BTCUSDT',
      side: 'BUY',
      qty: 1,
      type: 'MKT',
      tif: 'IOC',
      account: 'TEST',
      meta: { execRefPx: 50000 }
    };

    const startTime = Date.now();
    await adapter.submit(order);
    const endTime = Date.now();
    
    // Should have some latency (30-150ms)
    const latency = endTime - startTime;
    expect(latency).toBeGreaterThanOrEqual(30);
    expect(latency).toBeLessThan(200);
    
    expect(fills).toHaveLength(1);
  });

  it('applies slippage to market orders', async () => {
    const adapter = new PaperExecutionAdapter('paper', systemClock);
    const fills: any[] = [];
    
    adapter.events$.subscribe((event) => {
      if (event.type === 'order.fill') {
        fills.push(event.data);
      }
    });

    const buyOrder: OrderNew = {
      id: 'buy-1',
      t: Date.now(),
      symbol: 'BTCUSDT',
      side: 'BUY',
      qty: 1,
      type: 'MKT',
      tif: 'IOC',
      account: 'TEST',
      meta: { execRefPx: 50000 }
    };

    await adapter.submit(buyOrder);
    
    const buyFill = fills[0];
    // BUY should execute at ask (higher than ref price)
    expect(buyFill.px).toBeGreaterThan(50000);
    // Slippage should be realistic (2-5 bps = 10-25 USD on 50k)
    expect(buyFill.px).toBeLessThan(50030); // Max ~5 bps
    
    const sellOrder: OrderNew = {
      id: 'sell-1',
      t: Date.now(),
      symbol: 'BTCUSDT',
      side: 'SELL',
      qty: 1,
      type: 'MKT',
      tif: 'IOC',
      account: 'TEST',
      meta: { execRefPx: 50000 }
    };

    await adapter.submit(sellOrder);
    
    const sellFill = fills[1];
    // SELL should execute at bid (lower than ref price)
    expect(sellFill.px).toBeLessThan(50000);
    expect(sellFill.px).toBeGreaterThan(49970); // Max ~5 bps
  });

  it('provides price improvement on limit orders', async () => {
    const adapter = new PaperExecutionAdapter('paper', systemClock);
    const fills: any[] = [];
    
    adapter.events$.subscribe((event) => {
      if (event.type === 'order.fill') {
        fills.push(event.data);
      }
    });

    const limitBuyOrder: OrderNew = {
      id: 'limit-buy-1',
      t: Date.now(),
      symbol: 'BTCUSDT',
      side: 'BUY',
      qty: 1,
      type: 'LMT',
      px: 50000,
      tif: 'DAY',
      account: 'TEST'
    };

    await adapter.submit(limitBuyOrder);
    
    const buyFill = fills[0];
    // Limit BUY should get slight price improvement (fill lower)
    expect(buyFill.px).toBeLessThanOrEqual(50000);
    expect(buyFill.px).toBeGreaterThan(49995); // Within 1 bps improvement
  });
});
