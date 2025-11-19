import { describe, expect, it } from 'vitest';
import { createControlPlaneRouter } from './app';
import { loadConfig } from '@rx-trader/config';
import { InMemoryEventStore } from '@rx-trader/event-store';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const orderPayload = {
  id: crypto.randomUUID(),
  t: Date.now(),
  symbol: 'SIM',
  side: 'BUY',
  qty: 1,
  type: 'MKT',
  tif: 'DAY',
  account: 'TEST'
};

const post = (path: string, body: unknown) =>
  new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

const get = (path: string) => new Request(`http://test${path}`);
const authedGet = (path: string, token: string) =>
  new Request(`http://test${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });

describe('gateway integration', () => {
  it('accepts venue orders and updates positions', async () => {
    const config = loadConfig({ EVENT_STORE_DRIVER: 'memory', GATEWAY_PORT: '0' });
    const store = new InMemoryEventStore();
    const router = await createControlPlaneRouter(config, { store });

    const res = await router(post('/orders/binance', orderPayload));
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await store.append({
      id: crypto.randomUUID(),
      type: 'order.fill',
      ts: Date.now(),
      data: {
        id: crypto.randomUUID(),
        orderId: orderPayload.id,
        t: Date.now(),
        symbol: 'SIM',
        px: 101,
        qty: 1,
        side: 'BUY',
        fee: 0.1
      }
    });

    await store.append({
      id: crypto.randomUUID(),
      type: 'portfolio.snapshot',
      ts: Date.now(),
      data: {
        t: Date.now(),
        positions: {
          SIM: {
            t: Date.now(),
            symbol: 'SIM',
            pos: 1,
            px: 101,
            avgPx: 100,
            unrealized: 1,
            realized: 0,
            netRealized: 0,
            grossRealized: 0,
            notional: 101,
            pnl: 1
          }
        },
        nav: 101,
        pnl: 1,
        netRealized: 0,
        grossRealized: 0,
        realized: 0,
        unrealized: 1,
        cash: 0,
        feesPaid: 0
      }
    });

    const positionsRes = await router(get('/positions'));
    const positions = await positionsRes.json();
    expect(positions.SIM).toBeDefined();

    const tradesRes = await router(get('/trades'));
    expect(tradesRes.status).toBe(200);
    const trades = await tradesRes.json();
    expect(Array.isArray(trades.open)).toBe(true);
  });

  it('streams domain events over SSE', async () => {
    const config = loadConfig({ EVENT_STORE_DRIVER: 'memory', GATEWAY_PORT: '0' });
    const router = await createControlPlaneRouter(config);

    const streamResponse = await router(get('/events'));
    expect(streamResponse.status).toBe(200);
    const reader = streamResponse.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    const readEvent = async () => {
      if (!reader) {
        throw new Error('Missing reader');
      }
      let buffer = '';
      for (;;) {
        const { value } = await reader.read();
        if (!value) continue;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLine = chunk
            .split('\n')
            .find((line) => line.startsWith('data:') && line.trim().length > 5);
          if (dataLine) {
            const payload = dataLine.slice(5).trim();
            if (payload) {
              const event = JSON.parse(payload);
              if (event?.type) {
                return event;
              }
            }
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    };

    const waiter = readEvent();
    await router(post('/orders', orderPayload));
    const event = await waiter;
    expect(event.type).toBe('order.new');
    await reader?.cancel();
  });

  it('returns latest pnl analytics snapshot', async () => {
    const config = loadConfig({ EVENT_STORE_DRIVER: 'memory', GATEWAY_PORT: '0' });
    const store = new InMemoryEventStore();
    await store.append({
      id: crypto.randomUUID(),
      type: 'pnl.analytics',
      ts: Date.now(),
      data: {
        t: Date.now(),
        nav: 12_345,
        pnl: 123,
        realized: 100,
        netRealized: 100,
        grossRealized: 100,
        unrealized: 23,
        cash: 11_000,
        peakNav: 13_000,
        drawdown: -655,
        drawdownPct: -0.05,
        symbols: {
          BTCUSDT: {
            symbol: 'BTCUSDT',
            pos: 0.1,
            avgPx: 60_000,
            markPx: 61_000,
            realized: 50,
            netRealized: 50,
            grossRealized: 50,
            unrealized: 100,
            notional: 6_100
          }
        }
      }
    });
    const router = await createControlPlaneRouter(config, { store });

    const res = await router(get('/pnl'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nav).toBe(12_345);
    expect(body.realized).toBe(100);
  });

  it('persists and exposes backtest artifacts', async () => {
    const config = loadConfig({ EVENT_STORE_DRIVER: 'memory', GATEWAY_PORT: '0' });
    const store = new InMemoryEventStore();
    const router = await createControlPlaneRouter(config, { store });

    const artifact = {
      id: 'demo-artifact',
      summary: { nav: 100_000, pnl: 250, trades: 12 },
      createdAt: '2025-11-09T00:00:00.000Z'
    };

    const postRes = await router(post('/backtest/artifacts', artifact));
    expect(postRes.status).toBe(200);

    const getRes = await router(get('/backtest/artifacts'));
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body).toEqual(artifact);

    const events = await store.read();
    expect(events.at(-1)?.type).toBe('backtest.artifact');
    expect(events.at(-1)?.data).toEqual(artifact);
  });

  it('returns backtest artifact history with limits', async () => {
    const config = loadConfig({ EVENT_STORE_DRIVER: 'memory', GATEWAY_PORT: '0' });
    const store = new InMemoryEventStore();
    const router = await createControlPlaneRouter(config, { store });

    const first = {
      summary: { symbol: 'BTCUSDT', nav: 101_000, maxDrawdown: 500 },
      stats: { nav: { sharpe: 1 }, wallRuntimeMs: 1 }
    };
    const second = {
      summary: { symbol: 'ETHUSDT', nav: 202_000, maxDrawdown: 200 },
      stats: { nav: { sharpe: 2 }, wallRuntimeMs: 2 }
    };

    await router(post('/backtest/artifacts', first));
    await new Promise((resolve) => setTimeout(resolve, 2));
    await router(post('/backtest/artifacts', second));

    const res = await router(get('/backtest/artifacts/history?limit=1'));
    expect(res.status).toBe(200);
    const history = (await res.json()) as Array<{ summary?: { symbol?: string } }>;
    expect(history).toHaveLength(1);
    expect(history[0]?.summary?.symbol).toBe('ETHUSDT');

    const fullRes = await router(get('/backtest/artifacts/history?limit=10'));
    const fullHistory = (await fullRes.json()) as Array<{ summary?: { symbol?: string } }>;
    expect(fullHistory.map((entry) => entry.summary?.symbol)).toEqual(['ETHUSDT', 'BTCUSDT']);
  });

  it('returns recent orders', async () => {
    const config = loadConfig({ EVENT_STORE_DRIVER: 'memory', GATEWAY_PORT: '0' });
    const store = new InMemoryEventStore();
    const router = await createControlPlaneRouter(config, { store });

    await router(post('/orders', orderPayload));
    await router(post('/orders/binance', orderPayload));

    const res = await router(get('/orders/recent?limit=5'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ type: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.type.startsWith('order.')).toBe(true);
  });

  it('exposes feed health snapshots', async () => {
    const config = loadConfig({ EVENT_STORE_DRIVER: 'memory', GATEWAY_PORT: '0' });
    const router = await createControlPlaneRouter(config);

    const res = await router(get('/feeds/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns runtime status snapshot', async () => {
    const config = loadConfig({ EVENT_STORE_DRIVER: 'memory', GATEWAY_PORT: '0' });
    const router = await createControlPlaneRouter(config, { runtimeMeta: { live: true } });

    const res = await router(get('/status'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtime.live).toBe(true);
    expect(body.app.env).toBe(config.app.env);
    expect(Array.isArray(body.feeds)).toBe(true);
  });

  it('requires bearer token when configured', async () => {
    const config = loadConfig({
      EVENT_STORE_DRIVER: 'memory',
      GATEWAY_PORT: '0',
      CONTROL_PLANE_TOKEN: 'secret'
    });
    const router = await createControlPlaneRouter(config);

    const unauthorized = await router(get('/positions'));
    expect(unauthorized.status).toBe(401);

    const authorized = await router(authedGet('/positions', 'secret'));
    expect(authorized.status).toBe(200);
  });

  it('rate limits clients based on configured window', async () => {
    const config = loadConfig({
      EVENT_STORE_DRIVER: 'memory',
      GATEWAY_PORT: '0',
      CONTROL_PLANE_TOKEN: 'token',
      CONTROL_PLANE_RATE_WINDOW_MS: '1000',
      CONTROL_PLANE_RATE_MAX: '1'
    });
    const router = await createControlPlaneRouter(config);

    const first = await router(authedGet('/positions', 'token'));
    expect(first.status).toBe(200);

    const second = await router(authedGet('/positions', 'token'));
    expect(second.status).toBe(429);
  });

  it('serves built dashboard assets when configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rx-dashboard-'));
    writeFileSync(join(dir, 'index.html'), '<html><body>dashboard</body></html>');

    const config = loadConfig({
      EVENT_STORE_DRIVER: 'memory',
      GATEWAY_PORT: '0',
      DASHBOARD_DIST_DIR: dir
    });
    const router = await createControlPlaneRouter(config);

    const res = await router(get('/dashboard'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('dashboard');
  });
});
