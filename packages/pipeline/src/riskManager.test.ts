import { describe, expect, it, vi, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import type { OrderNew } from '@rx-trader/core/domain';
import { createRiskStreams, type RiskConfig } from './riskManager';
import type { RiskDecision } from '@rx-trader/risk/preTrade';
import * as riskModule from '@rx-trader/risk';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createRiskStreams', () => {
  it('delegates to splitRiskStream with provided config', () => {
    const intents$ = new Subject<OrderNew>();
    const config: RiskConfig = {
      notional: 1_000,
      maxPosition: 2,
      priceBands: { BTCUSDT: { min: 10, max: 100_000 } },
      throttle: { windowMs: 1_000, maxCount: 5 }
    };
    const approved$ = new Subject<RiskDecision>().asObservable();
    const rejected$ = new Subject<RiskDecision>().asObservable();

    const splitSpy = vi
      .spyOn(riskModule, 'splitRiskStream')
      .mockReturnValue([approved$, rejected$]);

    const result = createRiskStreams(intents$, config);
    expect(splitSpy).toHaveBeenCalledWith(intents$, config, undefined, undefined, undefined);
    expect(result.approved$).toBe(approved$);
    expect(result.rejected$).toBe(rejected$);
  });
});
