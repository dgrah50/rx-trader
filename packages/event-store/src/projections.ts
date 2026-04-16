import type {
  DomainEvent,
  PortfolioAnalytics,
  BalanceEntry,
  MarginSummary,
  PositionMark
} from '@rx-trader/core/domain';
import type { EventStore } from './eventStore';

interface Projection<TState> {
  name: string;
  init: () => TState;
  reduce: (state: TState, event: DomainEvent) => TState;
}

export const buildProjection = async <TState>(
  store: Pick<EventStore, 'read'>,
  projection: Projection<TState>,
  after?: number
): Promise<TState> => {
  const events = await store.read(after);
  return events.reduce(projection.reduce, projection.init());
};

export const ordersView: Projection<Record<string, DomainEvent>> = {
  name: 'orders_view',
  init: () => ({}),
  reduce: (state, event) => {
    if (event.type.startsWith('order.')) {
      const data = event.data as { id?: string } | undefined;
      const identifier = data?.id ?? event.id;
      state[identifier] = event;
    }
    return state;
  }
};

interface PositionState {
  positions: Record<string, PositionMark>;
  t?: number;
}

interface PortfolioSnapshotEventData {
  t: number;
  positions: Record<string, Partial<PositionMark>>;
}

export const positionsProjection: Projection<PositionState> = {
  name: 'positions',
  init: () => ({ positions: {} }),
  reduce: (state, event) => {
    if (event.type === 'portfolio.snapshot') {
      const data = event.data as PortfolioSnapshotEventData;
      const positions = data.positions ?? {};
      state.positions = Object.fromEntries(
        Object.entries(positions).map(([symbol, position]) => {
          const eventTs = position.t ?? data.t ?? event.ts ?? Date.now();
          const px = position.px ?? 0;
          const pos = position.pos ?? 0;
          const avgPx = position.avgPx ?? 0;
          const netRealized = position.netRealized ?? 0;
          const grossRealized = position.grossRealized ?? 0;
          const unrealized = position.unrealized ?? 0;
          const realized = position.realized ?? netRealized;
          const notional =
            typeof position.notional === 'number' && Number.isFinite(position.notional)
              ? position.notional
              : px * pos;
          const pnl =
            typeof position.pnl === 'number' && Number.isFinite(position.pnl)
              ? position.pnl
              : realized + unrealized;
          return [
            symbol,
            {
              t: eventTs,
              symbol,
              pos,
              px,
              avgPx,
              realized,
              netRealized,
              grossRealized,
              unrealized,
              notional,
              pnl
            } satisfies PositionMark
          ];
        })
      );
      state.t = data.t;
    }
    return state;
  }
};

interface PnlState {
  latest?: PortfolioAnalytics;
}

export const pnlProjection: Projection<PnlState> = {
  name: 'pnl',
  init: () => ({}),
  reduce: (state, event) => {
    if (event.type === 'pnl.analytics') {
      state.latest = event.data as PortfolioAnalytics;
    }
    return state;
  }
};

interface BalancesState {
  balances: Record<string, Record<string, BalanceEntry>>;
  updatedAt?: number;
}

interface BalanceAdjustedEventData {
  venue: string;
  asset: string;
  delta: number;
  newTotal?: number;
  t: number;
}

export const balancesProjection: Projection<BalancesState> = {
  name: 'account_balances',
  init: () => ({ balances: {} }),
  reduce: (state, event) => {
    if (event.type === 'account.balance.adjusted') {
      const data = event.data as BalanceAdjustedEventData;
      const venue = data.venue as BalanceEntry['venue'];
      const asset = data.asset;
      const venueBalances = state.balances[venue] ?? {};
      const existing = venueBalances[asset] ?? {
        venue,
        asset,
        available: 0,
        locked: 0,
        total: 0,
        lastUpdated: 0
      } satisfies BalanceEntry;
      const expected = existing.total + data.delta;
      const nextTotal =
        typeof data.newTotal === 'number' && Number.isFinite(data.newTotal)
          ? data.newTotal
          : expected;
      if (
        typeof data.newTotal === 'number' &&
        Math.abs(data.newTotal - expected) > 1e-6
      ) {
        throw new Error(
          `Balance delta mismatch for ${venue}/${asset}: expected ${expected} got ${data.newTotal}`
        );
      }
      venueBalances[asset] = {
        ...existing,
        total: nextTotal,
        available: nextTotal,
        lastUpdated: data.t
      };
      state.balances[venue] = venueBalances;
      const eventTs = data.t ?? event.ts ?? Date.now();
      state.updatedAt = Math.max(state.updatedAt ?? 0, eventTs);
    }
    return state;
  }
};

interface BalanceSnapshotEntry {
  total: number;
  ledgerTotal: number;
  drift: number;
  provider: string;
  t: number;
}

interface BalanceSnapshotEventData {
  venue: string;
  asset: string;
  total: number;
  ledgerTotal: number;
  drift: number;
  provider: string;
  t: number;
}

interface BalanceSnapshotState {
  snapshots: Record<string, Record<string, BalanceSnapshotEntry>>;
  updatedAt?: number;
}

export const balanceSnapshotsProjection: Projection<BalanceSnapshotState> = {
  name: 'account_balance_snapshots',
  init: () => ({ snapshots: {} }),
  reduce: (state, event) => {
    if (event.type === 'account.balance.snapshot') {
      const data = event.data as BalanceSnapshotEventData;
      const venueSnapshots = state.snapshots[data.venue] ?? {};
      venueSnapshots[data.asset] = {
        total: data.total,
        ledgerTotal: data.ledgerTotal,
        drift: data.drift,
        provider: data.provider,
        t: data.t
      };
      state.snapshots[data.venue] = venueSnapshots;
      const eventTs = data.t ?? event.ts ?? Date.now();
      state.updatedAt = Math.max(state.updatedAt ?? 0, eventTs);
    }
    return state;
  }
};

interface MarginState {
  summaries: Record<string, MarginSummary>;
  updatedAt?: number;
}

interface MarginUpdatedEventData {
  venue: string;
  summary: MarginSummary;
  t: number;
}

export const marginProjection: Projection<MarginState> = {
  name: 'account_margin',
  init: () => ({ summaries: {} }),
  reduce: (state, event) => {
    if (event.type === 'account.margin.updated') {
      const data = event.data as MarginUpdatedEventData;
      state.summaries[data.venue as MarginSummary['venue']] = data.summary;
      const eventTs = data.t ?? event.ts ?? Date.now();
      state.updatedAt = Math.max(state.updatedAt ?? 0, eventTs);
    }
    return state;
  }
};
