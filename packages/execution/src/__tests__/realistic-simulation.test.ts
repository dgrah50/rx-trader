import { describe, it, expect } from 'vitest';
import { PaperExecutionAdapter } from '../index';
import { systemClock } from '@rx-trader/core/time';
import { fillSchema, type Fill, type OrderNew } from '@rx-trader/core/domain';

describe('PaperExecutionAdapter - Realistic Simulation', () => {
  it('adds latency to order execution', async () => {
    const adapter = new PaperExecutionAdapter('paper', systemClock);
    const fills: Fill[] = [];
    
    adapter.events$.subscribe((event) => {
      if (event.type === 'order.fill') {
        fills.push(fillSchema.parse(event.data));
      }
    });

    const order: OrderNew = {
      id: '00000000-0000-4000-8000-000000000001',
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
    const fills: Fill[] = [];
    
    adapter.events$.subscribe((event) => {
      if (event.type === 'order.fill') {
        fills.push(fillSchema.parse(event.data));
      }
    });

    const buyOrder: OrderNew = {
      id: '00000000-0000-4000-8000-000000000002',
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
    expect(buyFill.px).toBeLessThan(50040);
    
    const sellOrder: OrderNew = {
      id: '00000000-0000-4000-8000-000000000003',
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
    expect(sellFill.px).toBeLessThan(50000);
    expect(sellFill.px).toBeGreaterThan(49960);
  });

  it('provides price improvement on limit orders', async () => {
    const adapter = new PaperExecutionAdapter('paper', systemClock);
    const fills: Fill[] = [];
    
    adapter.events$.subscribe((event) => {
      if (event.type === 'order.fill') {
        fills.push(fillSchema.parse(event.data));
      }
    });

    const limitBuyOrder: OrderNew = {
      id: '00000000-0000-4000-8000-000000000004',
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
