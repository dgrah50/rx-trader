import { Subject } from 'rxjs';
import { validateDomainEvent } from '@rx-trader/core/domain';
import type { DomainEvent } from '@rx-trader/core/domain';
import { systemClock } from '@rx-trader/core/time';

export interface EventStore {
  append: (events: DomainEvent | DomainEvent[]) => Promise<void>;
  read: (after?: number) => Promise<DomainEvent[]>;
  stream$: Subject<DomainEvent>;
  createSnapshot?<TState>(reduce: (events: DomainEvent[]) => TState): EventStoreSnapshot<TState>;
  restoreFromSnapshot?(
    snapshot: EventStoreSnapshot,
    restore: (snapshot: EventStoreSnapshot) => DomainEvent[]
  ): Promise<void> | void;
}

interface EventStoreSnapshot<TState = unknown> {
  id: string;
  ts: number;
  state: TState;
}

export class InMemoryEventStore implements EventStore {
  private events: DomainEvent[] = [];
  public readonly stream$ = new Subject<DomainEvent>();

  async append(eventOrEvents: DomainEvent | DomainEvent[]): Promise<void> {
    const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];
    events.forEach((event) => {
      const validated = validateDomainEvent(event);
      this.events.push(validated);
      this.stream$.next(validated);
    });
  }

  async read(after?: number): Promise<DomainEvent[]> {
    if (after === undefined) return [...this.events];
    return this.events.filter((event) => event.ts > after);
  }

  createSnapshot<TState>(reduce: (events: DomainEvent[]) => TState): EventStoreSnapshot<TState> {
    const state = reduce([...this.events]);
    return { id: crypto.randomUUID(), ts: systemClock.now(), state };
  }

  async restoreFromSnapshot(
    snapshot: EventStoreSnapshot,
    restore: (snapshot: EventStoreSnapshot) => DomainEvent[]
  ) {
    const events = restore(snapshot);
    this.events = [...events, ...this.events.filter((event) => event.ts > snapshot.ts)];
    events.forEach((event) => this.stream$.next(event));
  }
}
