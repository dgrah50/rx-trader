#!/usr/bin/env bun
import { loadConfig } from '@rx-trader/config';
import { createEventStore } from '@rx-trader/event-store';
import type {
  DomainEvent,
  OrderNew,
  Fill,
  PortfolioSnapshot,
  PortfolioAnalytics
} from '@rx-trader/core/domain';

const createOrder = (symbol: string, side: 'BUY' | 'SELL', qty: number, px: number): OrderNew => ({
  id: crypto.randomUUID(),
  t: Date.now(),
  symbol,
  side,
  qty,
  type: 'MKT',
  tif: 'DAY',
  account: 'TEST',
  meta: { px }
});

const createFill = (order: OrderNew, px: number): Fill => ({
  id: crypto.randomUUID(),
  orderId: order.id,
  t: Date.now(),
  symbol: order.symbol,
  px,
  qty: order.qty,
  side: order.side
});

const buildSnapshot = (fills: Fill[]): PortfolioSnapshot => {
  const positions: Record<
    string,
    {
      qty: number;
      avgPx: number;
      mark?: number;
      realized: number;
    }
  > = {};
  let cash = 0;
  let realized = 0;

  fills.forEach((fill) => {
    const signedQty = fill.side === 'BUY' ? fill.qty : -fill.qty;
    const current = positions[fill.symbol] ?? { qty: 0, avgPx: 0, realized: 0 };
    const nextQty = current.qty + signedQty;
    let nextAvg = current.avgPx;
    let realizedForSymbol = current.realized;

    if (Math.sign(current.qty) === Math.sign(nextQty) || current.qty === 0) {
      const gross = current.avgPx * current.qty + fill.px * signedQty;
      nextAvg = nextQty === 0 ? 0 : gross / nextQty;
    } else if (current.qty !== 0) {
      const closed = Math.min(Math.abs(signedQty), Math.abs(current.qty));
      const pnl = closed * (fill.px - current.avgPx) * Math.sign(current.qty);
      realized += pnl;
      realizedForSymbol += pnl;
      if (nextQty === 0) {
        nextAvg = 0;
      } else if (Math.sign(current.qty) !== Math.sign(nextQty)) {
        nextAvg = fill.px;
      }
    }

    positions[fill.symbol] = { qty: nextQty, avgPx: nextAvg, mark: fill.px, realized: realizedForSymbol };
    cash -= fill.px * signedQty;
  });

  const marks = Object.entries(positions).reduce<PortfolioSnapshot['positions']>(
    (acc, [symbol, position]) => {
      const px = position.mark ?? position.avgPx;
      const symbolRealized = position.realized ?? 0;
      acc[symbol] = {
        symbol,
        pos: position.qty,
        px,
        avgPx: position.avgPx,
        unrealized: (px - position.avgPx) * position.qty,
        realized: symbolRealized,
        notional: px * position.qty,
        t: Date.now()
      };
      return acc;
    },
    {}
  );

  const unrealized = Object.values(positions).reduce((acc, position) => {
    if (!position.mark) return acc;
    return acc + (position.mark - position.avgPx) * position.qty;
  }, 0);

  const nav = cash + realized + unrealized;
  const feesPaid = fills.reduce((sum, fill) => sum + (fill.fee ?? 0), 0);

  return {
    t: Date.now(),
    positions: marks,
    nav,
    pnl: realized + unrealized,
    realized,
    unrealized,
    cash,
    feesPaid
  };
};

const main = async () => {
  const config = loadConfig();
  const store = await createEventStore(config);

  const orders: OrderNew[] = [
    createOrder('BTCUSDT', 'BUY', 0.25, 62_000),
    createOrder('ETHUSDT', 'BUY', 2, 2_900),
    createOrder('BTCUSDT', 'SELL', 0.1, 63_500)
  ];

  const fills = orders.map((order) => createFill(order, (order.meta?.px as number) ?? 0));
  const snapshot = buildSnapshot(fills);

  const analytics: PortfolioAnalytics = {
    t: snapshot.t,
    nav: snapshot.nav,
    pnl: snapshot.pnl,
    realized: snapshot.realized,
    unrealized: snapshot.unrealized,
    cash: snapshot.cash,
    peakNav: snapshot.nav,
    drawdown: 0,
    drawdownPct: 0,
    feesPaid: snapshot.feesPaid,
    symbols: Object.fromEntries(
      Object.entries(snapshot.positions).map(([symbol, position]) => [
        symbol,
        {
          symbol,
          pos: position.pos,
          avgPx: position.avgPx,
          markPx: position.px,
          realized: position.realized,
          unrealized: position.unrealized,
          notional: position.notional
        }
      ])
    )
  };

  const events: DomainEvent[] = [
    ...orders.map(
      (order) =>
        ({
          id: crypto.randomUUID(),
          type: 'order.new',
          data: order,
          ts: order.t
        }) satisfies DomainEvent<'order.new', OrderNew>
    ),
    ...fills.map(
      (fill) =>
        ({
          id: crypto.randomUUID(),
          type: 'order.fill',
          data: fill,
          ts: fill.t
        }) satisfies DomainEvent<'order.fill', Fill>
    ),
    {
      id: crypto.randomUUID(),
      type: 'portfolio.snapshot',
      data: snapshot,
      ts: snapshot.t
    } satisfies DomainEvent<'portfolio.snapshot', PortfolioSnapshot>,
    {
      id: crypto.randomUUID(),
      type: 'pnl.analytics',
      data: analytics,
      ts: analytics.t
    } satisfies DomainEvent<'pnl.analytics', PortfolioAnalytics>
  ];

  await store.append(events);
  console.log(
    `Seeded ${orders.length} orders, ${fills.length} fills, portfolio NAV ${snapshot.nav.toFixed(2)}`
  );
};

void main();
