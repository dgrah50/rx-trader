import type { Subscription } from 'rxjs';
import type { EventStore } from '@rx-trader/event-store';
import { balancesProjection, marginProjection } from '@rx-trader/event-store';
import type { BalanceEntry, MarginSummary } from '@rx-trader/core/domain';

export interface AccountStateHandle {
  getBalance: (venue: string, asset: string) => BalanceEntry | undefined;
  getBalances: () => Record<string, Record<string, BalanceEntry>>;
  getMarginSummary: (venue: string) => MarginSummary | undefined;
  stop: () => void;
}

const reduceAll = <TState>(
  projection: typeof balancesProjection | typeof marginProjection,
  events: Awaited<ReturnType<EventStore['read']>>,
  state: TState
) => {
  events.forEach((event) => {
    // @ts-expect-error reduce signature mismatch between projections
    projection.reduce(state, event);
  });
};

export const createAccountState = async (store: EventStore): Promise<AccountStateHandle> => {
  const balancesState = balancesProjection.init();
  const marginState = marginProjection.init();
  const events = await store.read();
  reduceAll(balancesProjection, events, balancesState);
  reduceAll(marginProjection, events, marginState);

  const subscription: Subscription = store.stream$.subscribe((event) => {
    balancesProjection.reduce(balancesState, event);
    marginProjection.reduce(marginState, event);
  });

  return {
    getBalance: (venue: string, asset: string) =>
      balancesState.balances[venue]?.[asset] ?? undefined,
    getBalances: () => balancesState.balances,
    getMarginSummary: (venue: string) => marginState.summaries[venue],
    stop: () => subscription.unsubscribe()
  };
};
