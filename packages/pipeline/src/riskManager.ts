import type { Observable } from 'rxjs';
import type { OrderNew } from '@rx-trader/core/domain';
import { splitRiskStream, type AccountExposureGuard, type RiskLimits } from '@rx-trader/risk';
import type { Clock } from '@rx-trader/core/time';

export type RiskConfig = RiskLimits;

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
  marketExposureGuard?: { updateMargin: (order: OrderNew) => void; canAccept: (order: OrderNew, notional: number) => boolean },
  reconcile$?: Observable<OrderNew>
): RiskStreams => {
  const [approved$, rejected$] = splitRiskStream(
    intents$,
    config,
    clock,
    accountGuard,
    marketExposureGuard,
    reconcile$
  );
  return { approved$, rejected$ };
};
