import { map, filter } from 'rxjs';
import type { Observable } from 'rxjs';
import type { PortfolioSnapshot } from '@rx-trader/core/domain';

interface PostTradeLimit {
  navFloor: number;
  maxDrawdown: number;
}

interface PostTradeDecision {
  snapshot: PortfolioSnapshot;
  action?: 'HALT' | 'FLATTEN';
  reason?: string;
}

export const monitorPostTradeRisk = (
  snapshots$: Observable<PortfolioSnapshot>,
  limits: PostTradeLimit
): Observable<PostTradeDecision> => {
  return snapshots$.pipe(
    map((snapshot): PostTradeDecision => {
      if (snapshot.nav < limits.navFloor) {
        return { snapshot, action: 'HALT', reason: 'nav-floor' };
      }
      if (snapshot.pnl < -limits.maxDrawdown) {
        return { snapshot, action: 'FLATTEN', reason: 'drawdown' };
      }
      return { snapshot };
    }),
    filter((decision): decision is PostTradeDecision & { action: 'HALT' | 'FLATTEN'; reason: string } =>
      Boolean(decision.action)
    )
  );
};
