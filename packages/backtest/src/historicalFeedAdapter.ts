import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import type { FeedAdapter } from '@rx-trader/feeds';

export class HistoricalFeedAdapter implements FeedAdapter {
  public readonly id: string;
  public readonly feed$: Observable<MarketTick>;
  private readonly subject = new Subject<MarketTick>();

  constructor(id: string) {
    this.id = id;
    this.feed$ = this.subject.asObservable();
  }

  push(tick: MarketTick) {
    this.subject.next(tick);
  }

  complete() {
    this.subject.complete();
  }

  connect() {
    // no-op; data is pushed via the runner
  }
}
