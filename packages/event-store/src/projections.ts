import type {
  DomainEvent,
  PortfolioAnalytics,
  BalanceEntry,
  MarginSummary
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
  positions: Record<string, { pos: number; avgPx: number; px: number; pnl?: number }>;
  t?: number;
}

export const positionsProjection: Projection<PositionState> = {
  name: 'positions',
  init: () => ({ positions: {} }),
  reduce: (state, event) => {
    if (event.type === 'portfolio.snapshot') {
      const data = event.data as any;
      state.positions = data.positions ?? {};
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

export const balancesProjection: Projection<BalancesState> = {
  name: 'account_balances',
  init: () => ({ balances: {} }),
  reduce: (state, event) => {
    if (event.type === 'account.balance.adjusted') {
      const data = event.data as any;
      const venue = data.venue;
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

interface BalanceSnapshotState {
  snapshots: Record<string, Record<string, BalanceSnapshotEntry>>;
  updatedAt?: number;
}

export const balanceSnapshotsProjection: Projection<BalanceSnapshotState> = {
  name: 'account_balance_snapshots',
  init: () => ({ snapshots: {} }),
  reduce: (state, event) => {
    if (event.type === 'account.balance.snapshot') {
      const data = event.data as any;
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

export const marginProjection: Projection<MarginState> = {
  name: 'account_margin',
  init: () => ({ summaries: {} }),
  reduce: (state, event) => {
    if (event.type === 'account.margin.updated') {
      const data = event.data as any;
      state.summaries[data.venue] = data.summary as MarginSummary;
      const eventTs = data.t ?? event.ts ?? Date.now();
      state.updatedAt = Math.max(state.updatedAt ?? 0, eventTs);
    }
    return state;
  }
};
