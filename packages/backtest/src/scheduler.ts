import type { SchedulerAction, SchedulerLike } from 'rxjs';
import { Subscription } from 'rxjs';
import type { Clock } from '@rx-trader/core/time';

export class BacktestScheduler implements SchedulerLike, Clock {
  private currentTime: number;

  constructor(startTime: number = Date.now()) {
    this.currentTime = startTime;
  }

  now = (): number => this.currentTime;

  advanceTo = (timestamp: number) => {
    if (timestamp < this.currentTime) {
      throw new Error(`BacktestScheduler cannot move backwards (current=${this.currentTime}, next=${timestamp})`);
    }
    this.currentTime = timestamp;
  };

  flush = () => {
    // no queued work yet; placeholder for future scheduler tasks
  };

  schedule: SchedulerLike['schedule'] = <T>(
    work: (this: SchedulerAction<T>, state?: T) => void,
    delay = 0,
    state?: T
  ) => {
    if (delay > 0) {
      this.advanceTo(this.currentTime + delay);
    }
    const action = {
      schedule: (innerState?: T, innerDelay = 0) => this.schedule(work, innerDelay, innerState),
      unsubscribe() {}
    } as SchedulerAction<T>;
    work.call(action, state);
    return new Subscription();
  };
}
