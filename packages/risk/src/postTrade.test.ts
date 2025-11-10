import { describe, expect, it } from 'vitest';
import { Subject, firstValueFrom } from 'rxjs';
import { monitorPostTradeRisk } from './postTrade';
import type { PortfolioSnapshot } from '@rx-trader/core/domain';

const snapshot = (overrides: Partial<PortfolioSnapshot>): PortfolioSnapshot => ({
  t: Date.now(),
  positions: {},
  nav: 0,
  pnl: 0,
  realized: 0,
  unrealized: 0,
  cash: 0,
  ...overrides
});

describe('monitorPostTradeRisk', () => {
  it('emits HALT when NAV drops below floor', async () => {
    const snapshots$ = new Subject<PortfolioSnapshot>();
    const decisions$ = monitorPostTradeRisk(snapshots$, { navFloor: 0, maxDrawdown: 5_000 });

    const decisionPromise = firstValueFrom(decisions$);
    snapshots$.next(snapshot({ nav: -1_000, pnl: -100 }));

    const decision = await decisionPromise;
    expect(decision.action).toBe('HALT');
    expect(decision.reason).toBe('nav-floor');
  });

  it('emits FLATTEN on drawdown breach', async () => {
    const snapshots$ = new Subject<PortfolioSnapshot>();
    const decisions$ = monitorPostTradeRisk(snapshots$, { navFloor: -10_000, maxDrawdown: 1_000 });

    const decisionPromise = firstValueFrom(decisions$);
    snapshots$.next(snapshot({ pnl: -2_000 }));

    const decision = await decisionPromise;
    expect(decision.action).toBe('FLATTEN');
    expect(decision.reason).toBe('drawdown');
  });
});
