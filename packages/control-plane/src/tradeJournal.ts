import type { DomainEvent, Fill } from '@rx-trader/core/domain';

type TradeDirection = 'LONG' | 'SHORT';

export interface ClosedTrade {
  symbol: string;
  qty: number;
  entryPx: number;
  exitPx: number;
  entryTs: number;
  exitTs: number;
  realizedPnl: number;
  fees: number;
  direction: TradeDirection;
}

export interface OpenTrade {
  symbol: string;
  qty: number;
  avgPx: number;
  entryTs: number;
  markPx: number;
  unrealizedPnl: number;
  fees: number;
  direction: TradeDirection;
}

interface TradeState {
  qty: number;
  avgPx: number;
  entryTs: number;
  fees: number;
}

const directionFromQty = (qty: number): TradeDirection => (qty >= 0 ? 'LONG' : 'SHORT');

type PositionMarkShape = {
  symbol?: string;
  pos?: number;
  avgPx?: number;
  px?: number;
  t?: number;
  realized?: number;
  unrealized?: number;
  notional?: number;
  pnl?: number;
};

export const buildTradeJournal = (
  events: DomainEvent[],
  marks: Record<string, Partial<PositionMarkShape>>
): { open: OpenTrade[]; closed: ClosedTrade[] } => {
  const fillEvents = events
    .filter((event) => event.type === 'order.fill')
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

  const states = new Map<string, TradeState>();
  const closedTrades: ClosedTrade[] = [];

  for (const event of fillEvents) {
    const fill = event.data as Fill;
    if (!fill || typeof fill.px !== 'number' || typeof fill.qty !== 'number') {
      continue;
    }
    const signedFillQty = fill.side === 'BUY' ? fill.qty : -fill.qty;
    if (signedFillQty === 0) {
      continue;
    }
    const fillFee = Number.isFinite(fill.fee) ? Math.abs(fill.fee!) : 0;
    const symbol = (fill.symbol ?? '').toUpperCase();
    const state = states.get(symbol) ?? { qty: 0, avgPx: 0, entryTs: fill.t ?? event.ts ?? Date.now(), fees: 0 };

    let remainingQty = signedFillQty;
    let remainingFee = fillFee;
    const fillAbs = Math.abs(signedFillQty);

    const isClosing = state.qty !== 0 && Math.sign(state.qty) !== Math.sign(remainingQty);
    if (isClosing) {
      const currentSign = Math.sign(state.qty);
      const closeAbs = Math.min(Math.abs(state.qty), Math.abs(remainingQty));
      if (closeAbs > 0 && Math.abs(state.qty) > 0) {
        const openQtyAbs = Math.abs(state.qty);
        const feeShareRatio = closeAbs / openQtyAbs;
        const allocatedOpenFees = state.fees * feeShareRatio;
        state.fees -= allocatedOpenFees;

        const closeRatioOnFill = fillAbs > 0 ? closeAbs / fillAbs : 0;
        const feeForClose = remainingFee * closeRatioOnFill;
        remainingFee -= feeForClose;

        const realized = closeAbs * (fill.px - state.avgPx) * currentSign;
        closedTrades.push({
          symbol,
          qty: closeAbs,
          entryPx: state.avgPx,
          exitPx: fill.px,
          entryTs: state.entryTs,
          exitTs: fill.t ?? event.ts ?? Date.now(),
          direction: directionFromQty(state.qty),
          realizedPnl: realized - allocatedOpenFees - feeForClose,
          fees: allocatedOpenFees + feeForClose
        });

        state.qty -= currentSign * closeAbs;
        remainingQty += currentSign * closeAbs;
        if (state.qty === 0) {
          state.avgPx = 0;
          state.entryTs = 0;
          state.fees = 0;
        }
      }
    }

    if (remainingQty !== 0) {
      const remainingSign = Math.sign(remainingQty);
      const absRemaining = Math.abs(remainingQty);
      const absCurrent = Math.abs(state.qty);

      if (absCurrent === 0 || Math.sign(state.qty) === remainingSign || state.qty === 0) {
        if (absCurrent === 0) {
          state.avgPx = fill.px;
          state.entryTs = fill.t ?? event.ts ?? Date.now();
          state.fees = remainingFee;
        } else {
          state.avgPx = (state.avgPx * absCurrent + fill.px * absRemaining) / (absCurrent + absRemaining);
          state.fees += remainingFee;
        }
        state.qty += remainingQty;
      } else {
        // flipped direction completely; treat remainder as fresh position
        state.avgPx = fill.px;
        state.entryTs = fill.t ?? event.ts ?? Date.now();
        state.fees = remainingFee;
        state.qty = remainingQty;
      }
    }

    states.set(symbol, state);
  }

  const openTrades: OpenTrade[] = Array.from(states.entries())
    .filter(([, state]) => state.qty !== 0)
    .map(([symbol, state]) => {
      const mark = marks[symbol]?.px ?? state.avgPx;
      const dir = directionFromQty(state.qty);
      const grossUnrealized = (mark - state.avgPx) * Math.abs(state.qty) * (state.qty >= 0 ? 1 : -1);
      const unrealizedPnl = grossUnrealized - state.fees;
      return {
        symbol,
        qty: Math.abs(state.qty),
        avgPx: state.avgPx,
        entryTs: state.entryTs,
        markPx: mark,
        unrealizedPnl,
        fees: state.fees,
        direction: dir
      };
    })
    .sort((a, b) => Math.abs(b.qty * b.markPx) - Math.abs(a.qty * a.markPx));

  const limitedClosed = closedTrades
    .sort((a, b) => a.exitTs - b.exitTs)
    .slice(-50)
    .reverse();

  return { open: openTrades, closed: limitedClosed };
};
