import { Subject } from 'rxjs';
import { validateDomainEvent } from '@rx-trader/core/domain';
import type { DomainEvent } from '@rx-trader/core/domain';
import { systemClock } from '@rx-trader/core/time';

export interface EventStore {
  append: (events: DomainEvent | DomainEvent[]) => Promise<void>;
  read: (after?: number) => Promise<DomainEvent[]>;
  readCommitted: (afterCursor?: number) => Promise<EventStoreReadResult>;
  stream$: Subject<DomainEvent>;
  close?: () => Promise<void> | void;
  createSnapshot?<TState>(reduce: (events: DomainEvent[]) => TState): EventStoreSnapshot<TState>;
  restoreFromSnapshot?(
    snapshot: EventStoreSnapshot,
    restore: (snapshot: EventStoreSnapshot) => DomainEvent[]
  ): Promise<void> | void;
}

export interface EventStoreReadResult {
  events: DomainEvent[];
  cursor: number;
}

interface EventStoreSnapshot<TState = unknown> {
  id: string;
  ts: number;
  state: TState;
}

export class InMemoryEventStore implements EventStore {
  private events: DomainEvent[] = [];
  private readonly eventIds = new Set<string>();
  private readonly dedupeKeys = new Set<string>();
  private readonly sequences = new Map<string, number>();
  private nextSequence = 1;
  public readonly stream$ = new Subject<DomainEvent>();

  async append(eventOrEvents: DomainEvent | DomainEvent[]): Promise<void> {
    const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];
    const validatedEvents = events.map((event) => validateDomainEvent(event));
    validatedEvents.forEach((validated) => {
      if (
        this.eventIds.has(validated.id) ||
        (validated.dedupeKey !== undefined && this.dedupeKeys.has(validated.dedupeKey))
      ) {
        return;
      }
      this.events.push(validated);
      this.sequences.set(validated.id, this.nextSequence++);
      this.eventIds.add(validated.id);
      if (validated.dedupeKey !== undefined) {
        this.dedupeKeys.add(validated.dedupeKey);
      }
      this.stream$.next(validated);
    });
  }

  async read(after?: number): Promise<DomainEvent[]> {
    if (after === undefined) return [...this.events];
    return this.events.filter((event) => event.ts > after);
  }

  async readCommitted(afterCursor = 0): Promise<EventStoreReadResult> {
    const events = this.events.filter((event) => (this.sequences.get(event.id) ?? 0) > afterCursor);
    return { events, cursor: this.nextSequence - 1 };
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
    this.eventIds.clear();
    this.dedupeKeys.clear();
    this.sequences.clear();
    this.nextSequence = 1;
    this.events.forEach((event) => {
      this.sequences.set(event.id, this.nextSequence++);
      this.eventIds.add(event.id);
      if (event.dedupeKey !== undefined) this.dedupeKeys.add(event.dedupeKey);
    });
    events.forEach((event) => this.stream$.next(event));
  }
}
