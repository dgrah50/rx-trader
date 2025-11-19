import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import type { DomainEvent } from '../domain/events';

export class EventBus {
  private bus$ = new Subject<DomainEvent>();

  emit(event: DomainEvent): void {
    this.bus$.next(event);
  }

  on<T extends DomainEvent['type']>(type: T): Observable<DomainEvent<T>> {
    return this.bus$.pipe(
      filter((event): event is DomainEvent<T> => event.type === type)
    );
  }

  onAll(): Observable<DomainEvent> {
    return this.bus$.asObservable();
  }
}
