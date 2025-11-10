import { timer, map, take } from 'rxjs';
import type { Observable } from 'rxjs';
import type { SentimentSample } from '@rx-trader/core/domain';

export interface SentimentFeedAdapterOptions {
  intervalMs?: number;
}

export class SentimentFeedAdapter {
  public readonly id: string;
  public readonly feed$: Observable<SentimentSample>;

  constructor(id: string, private readonly samples: SentimentSample[], options: SentimentFeedAdapterOptions = {}) {
    this.id = id;
    const intervalMs = options.intervalMs ?? 1000;
    this.feed$ = timer(0, intervalMs).pipe(
      take(samples.length),
      map((index) => samples[index])
    );
  }

  connect() {
    // no-op
  }
}
