import type { MarketTick } from '@rx-trader/core/domain';
import type { Observable } from 'rxjs';

export type StrategyAction = 'BUY' | 'SELL';

export interface StrategyFeedSource {
  id: string;
  feed$: Observable<MarketTick>;
}

export interface StrategySignal {
  symbol: string;
  action: StrategyAction;
  px: number;
  t: number;
}
