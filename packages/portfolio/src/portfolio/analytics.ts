import { scan, map, shareReplay } from 'rxjs';
import type { Observable } from 'rxjs';
import type { PortfolioAnalytics, PortfolioSnapshot } from '@rx-trader/core/domain';

interface AnalyticsState {
  peakNav: number;
  feesPaid: number;
  analytics?: PortfolioAnalytics;
}

const initialState: AnalyticsState = {
  peakNav: 0,
  feesPaid: 0,
  analytics: undefined
};

export const portfolioAnalytics$ = (
  snapshots$: Observable<PortfolioSnapshot>
): Observable<PortfolioAnalytics> => {
  return snapshots$.pipe(
    scan(
      (state, snapshot) => {
        const peakNav = Math.max(state.peakNav, snapshot.nav);
        const drawdown = snapshot.nav - peakNav;
        const feesPaid = snapshot.feesPaid ?? state.feesPaid;
        const symbols = Object.fromEntries(
          Object.entries(snapshot.positions).map(([symbol, position]) => [
            symbol,
            {
              symbol,
              pos: position.pos,
              avgPx: position.avgPx,
              markPx: position.px,
              realized: position.realized,
              unrealized: position.unrealized,
              notional: position.notional
            }
          ])
        );
        return {
          peakNav,
          feesPaid,
          analytics: {
            t: snapshot.t,
            nav: snapshot.nav,
            pnl: snapshot.pnl,
            realized: snapshot.realized,
            unrealized: snapshot.unrealized,
            cash: snapshot.cash,
            peakNav,
            drawdown,
            drawdownPct: peakNav === 0 ? 0 : drawdown / peakNav,
            feesPaid,
            symbols
          } satisfies PortfolioAnalytics
        };
      },
      initialState
    ),
    map((state) => state.analytics!),
    shareReplay({ bufferSize: 1, refCount: true })
  );
};
