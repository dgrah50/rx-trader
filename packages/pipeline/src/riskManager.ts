import type { Observable } from 'rxjs';
import type { OrderNew } from '@rx-trader/core/domain';
import { splitRiskStream } from '@rx-trader/risk';
import type { Clock } from '@rx-trader/core/time';
import type { AccountExposureGuard } from '@rx-trader/risk/preTrade';

export interface RiskConfig {
  notional: number;
  maxPosition: number;
  priceBands: Record<string, { min: number; max: number }>;
  throttle: { windowMs: number; maxCount: number };
}

type RiskStreamTuple = ReturnType<typeof splitRiskStream>;

interface RiskStreams {
  approved$: RiskStreamTuple[0];
  rejected$: RiskStreamTuple[1];
}

export const createRiskStreams = (
  intents$: Observable<OrderNew>,
  config: RiskConfig,
  clock?: Clock,
  accountGuard?: AccountExposureGuard,
  marketExposureGuard?: { updateMargin: (order: OrderNew) => void; canAccept: (order: OrderNew, notional: number) => boolean }
): RiskStreams => {
  const [approved$, rejected$] = splitRiskStream(
    intents$,
    config,
    clock,
    accountGuard,
    marketExposureGuard
  );
  return { approved$, rejected$ };
};
