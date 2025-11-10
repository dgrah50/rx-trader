import { scan, map, shareReplay } from 'rxjs';
import type { Observable } from 'rxjs';
import type { PortfolioAnalytics, PortfolioSnapshot } from '@rx-trader/core/domain';

interface AnalyticsState {
  peakNav: number;
}

const initialState: AnalyticsState = {
  peakNav: 0
};

export const portfolioAnalytics$ = (
  snapshots$: Observable<PortfolioSnapshot>
): Observable<PortfolioAnalytics> => {
  return snapshots$.pipe(
    scan(
      (state, snapshot) => {
        const peakNav = Math.max(state.peakNav, snapshot.nav);
        const drawdown = snapshot.nav - peakNav;
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
            symbols
          } satisfies PortfolioAnalytics
        };
      },
      { ...initialState, analytics: undefined as PortfolioAnalytics | undefined }
    ),
    map((state) => state.analytics!),
    shareReplay({ bufferSize: 1, refCount: true })
  );
};
