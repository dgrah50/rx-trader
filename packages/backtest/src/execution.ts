import { filter, map, share } from 'rxjs';
import type { DomainEvent, Fill, MarketTick, OrderNew, OrderAck, OrderReject } from '@rx-trader/core/domain';
import { ExecutionVenue } from '@rx-trader/core/constants';
import { PaperExecutionAdapter } from '@rx-trader/execution';
import type { Clock } from '@rx-trader/core/time';

class BacktestPaperAdapter extends PaperExecutionAdapter {
  constructor(clock: Clock, private readonly getLatestTick: () => MarketTick | undefined) {
    super(`${ExecutionVenue.Paper}-backtest`, clock);
  }

  override async submit(order: OrderNew): Promise<void> {
    const ts = this.clock.now();
    const latest = this.getLatestTick();
    const px = order.px ?? latest?.last ?? latest?.bid ?? latest?.ask;
    if (!px) {
      throw new Error(`No reference price available for ${order.symbol}`);
    }
    this.ack(order.id, ts);
    this.fill(order, { px }, ts);
  }
}

interface BacktestExecutionManagerOptions {
  clock: Clock;
  enqueue: (event: DomainEvent) => void;
  getLatestTick: () => MarketTick | undefined;
}

export const createBacktestExecutionManager = (options: BacktestExecutionManagerOptions) => {
  const adapter = new BacktestPaperAdapter(options.clock, options.getLatestTick);

  const events$ = adapter.events$.pipe(share());

  events$.subscribe((event) => {
    options.enqueue(event as DomainEvent);
  });

  const fills$ = events$.pipe(
    filter((event) => event.type === 'order.fill'),
    map((event) => event.data as Fill),
    share()
  );

  const acks$ = events$.pipe(
    filter((event) => event.type === 'order.ack'),
    map((event) => event.data as OrderAck),
    share()
  );

  const rejects$ = events$.pipe(
    filter((event) => event.type === 'order.reject'),
    map((event) => event.data as OrderReject),
    share()
  );

  const submit = (order: OrderNew) => adapter.submit(order);

  return { adapter, events$, fills$, acks$, rejects$, submit };
};
