import { merge, scan, map, shareReplay, EMPTY } from 'rxjs';
import type { Observable } from 'rxjs';
import type { Fill, MarketTick, PortfolioSnapshot } from '@rx-trader/core/domain';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';

interface PositionState {
  qty: number;
  avgPx: number;
  mark?: number;
  realized: number;
}

interface PortfolioState {
  positions: Record<string, PositionState>;
  cash: number;
  realizedPnl: number;
  feesPaid: number;
}

const createInitialState = (initialCash = 0): PortfolioState => ({
  positions: {},
  cash: initialCash,
  realizedPnl: 0,
  feesPaid: 0
});

const applyFill = (state: PortfolioState, fill: Fill): PortfolioState => {
  const current = state.positions[fill.symbol] ?? { qty: 0, avgPx: 0, realized: 0 };
  const signedQty = fill.side === 'BUY' ? fill.qty : -fill.qty;
  const nextQty = current.qty + signedQty;
  let nextAvg = current.avgPx;
  let realizedForSymbol = current.realized;

  const sameDirection = current.qty === 0 || Math.sign(current.qty) === Math.sign(signedQty);

  if (sameDirection) {
    const gross = current.avgPx * current.qty + fill.px * signedQty;
    nextAvg = nextQty === 0 ? 0 : gross / nextQty;
  } else if (current.qty !== 0) {
    const closed = Math.min(Math.abs(signedQty), Math.abs(current.qty));
    const pnl = closed * (fill.px - current.avgPx) * Math.sign(current.qty);
    state.realizedPnl += pnl;
    realizedForSymbol += pnl;
    if (nextQty === 0) {
      nextAvg = 0;
    } else if (Math.sign(current.qty) !== Math.sign(nextQty)) {
      nextAvg = fill.px;
    } else {
      nextAvg = current.avgPx;
    }
  }

  state.positions[fill.symbol] = { qty: nextQty, avgPx: nextAvg, mark: fill.px, realized: realizedForSymbol };
  state.cash -= fill.px * signedQty;
  if (fill.fee && fill.fee > 0) {
    state.cash -= fill.fee;
    state.realizedPnl -= fill.fee;
    state.feesPaid += fill.fee;
    realizedForSymbol -= fill.fee;
    state.positions[fill.symbol].realized = realizedForSymbol;
  }
  return state;
};

const applyMark = (state: PortfolioState, tick: MarketTick): PortfolioState => {
  const position = state.positions[tick.symbol];
  if (position) {
    position.mark = tick.last ?? tick.bid ?? tick.ask ?? position.avgPx;
  }
  return state;
};

interface PortfolioStreams {
  fills$: Observable<Fill>;
  marks$: Observable<MarketTick>;
  cashAdjustments$?: Observable<number>;
  initialCash?: number;
}

export const portfolio$ = (
  { fills$, marks$, cashAdjustments$, initialCash }: PortfolioStreams,
  clock?: Clock
): Observable<PortfolioSnapshot> => {
  const now = clock?.now ?? systemClock.now;
  const reducers$ = merge(
    fills$.pipe(map((fill) => (state: PortfolioState) => applyFill(state, fill))),
    marks$.pipe(map((tick) => (state: PortfolioState) => applyMark(state, tick))),
    cashAdjustments$
      ? cashAdjustments$.pipe(
          map((delta) => (state: PortfolioState) => {
            if (!Number.isFinite(delta) || delta === 0) {
              return state;
            }
            state.cash += delta;
            return state;
          })
        )
      : EMPTY
  );
  return reducers$.pipe(
    scan((state, reducer) =>
      reducer({
        positions: { ...state.positions },
        cash: state.cash,
        realizedPnl: state.realizedPnl,
        feesPaid: state.feesPaid
      }),
      createInitialState(initialCash)
    ),
    map((state) => {
      const marked = Object.fromEntries(
        Object.entries(state.positions).map(([symbol, position]) => {
          const px = position.mark ?? position.avgPx;
          const unrealized = (px - position.avgPx) * position.qty;
          return [
            symbol,
            {
              t: now(),
              symbol,
              pos: position.qty,
              px,
              avgPx: position.avgPx,
              unrealized,
              realized: position.realized,
              notional: px * position.qty
            }
          ];
        })
      );
      const marketValue = Object.values(marked).reduce((acc, position) => acc + position.notional, 0);
      const unrealized = Object.values(marked).reduce((acc, position) => acc + position.unrealized, 0);
      return {
        t: now(),
        positions: marked,
        nav: state.cash + marketValue,
        pnl: state.realizedPnl + unrealized,
        realized: state.realizedPnl,
        unrealized,
        cash: state.cash,
        feesPaid: state.feesPaid
      } satisfies PortfolioSnapshot;
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );
};
