import type { EventStore } from './eventStore';
import type { Metrics } from '@rx-trader/observability/metrics';

export const instrumentEventStore = (
  store: EventStore,
  metrics: Metrics | undefined,
  driver: string
): EventStore => {
  if (!metrics) {
    return store;
  }

  const append = async (eventOrEvents: Parameters<EventStore['append']>[0]) => {
    const stop = metrics.eventStoreAppendDuration.labels({ driver }).startTimer();
    try {
      await store.append(eventOrEvents);
    } finally {
      stop();
    }
  };

  const read = async (after?: number) => {
    const mode = after === undefined ? 'full' : 'tail';
    const stop = metrics.eventStoreReadDuration.labels({ driver, mode }).startTimer();
    try {
      return await store.read(after);
    } finally {
      stop();
    }
  };

  return {
    append,
    read,
    stream$: store.stream$,
    createSnapshot: store.createSnapshot?.bind(store),
    restoreFromSnapshot: store.restoreFromSnapshot?.bind(store)
  };
};
