import { filter, map, share } from 'rxjs';
import type { Observable } from 'rxjs';
import type { OrderNew } from '@rx-trader/core/domain';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';

interface PriceBand {
  min: number;
  max: number;
}

export interface RiskLimits {
  notional: number;
  maxPosition: number;
  priceBands: Record<string, PriceBand>;
  throttle: {
    windowMs: number;
    maxCount: number;
  };
}

export interface RiskDecision {
  order: OrderNew;
  allowed: boolean;
  reasons?: string[];
}

export interface AccountExposureGuard {
  venue: string;
  baseAsset: string;
  quoteAsset: string;
  getAvailable: (venue: string, asset: string) => number | null;
}

export const createPreTradeRisk = (
  limits: RiskLimits,
  now: () => number = systemClock.now,
  accountGuard?: AccountExposureGuard
) => {
  const exposures: Record<string, number> = {};
  let orderLog: Array<{ ts: number }> = [];

  return (order: OrderNew): RiskDecision => {
    const reasons: string[] = [];
    const notional = order.qty * (order.px ?? 0);
    if (limits.notional && notional > limits.notional) {
      reasons.push(`notional>${limits.notional}`);
    }

    const position = exposures[order.symbol] ?? 0;
    const next = position + (order.side === 'BUY' ? order.qty : -order.qty);
    if (Math.abs(next) > limits.maxPosition) {
      reasons.push(`position>${limits.maxPosition}`);
    }

    const band = limits.priceBands[order.symbol];
    if (band && order.px) {
      if (order.px < band.min || order.px > band.max) {
        reasons.push('price-band');
      }
    }

    const ts = now();
    orderLog = orderLog.filter((entry) => ts - entry.ts <= limits.throttle.windowMs);
    if (orderLog.length >= limits.throttle.maxCount) {
      reasons.push('throttle');
    } else {
      orderLog.push({ ts });
    }

    if (accountGuard) {
      const venue = accountGuard.venue;
      if (order.side === 'BUY' && order.px) {
        const availableQuote = accountGuard.getAvailable(venue, accountGuard.quoteAsset);
        if (availableQuote !== null) {
          if (availableQuote < notional) {
            reasons.push('insufficient-quote');
          }
        }
      }
      if (order.side === 'SELL') {
        const availableBase = accountGuard.getAvailable(venue, accountGuard.baseAsset);
        if (availableBase !== null) {
          if (availableBase < order.qty) {
            reasons.push('insufficient-base');
          }
        }
      }
    }

    const allowed = reasons.length === 0;
    if (allowed) {
      exposures[order.symbol] = next;
    }

    return { order, allowed, reasons: allowed ? undefined : reasons };
  };
};

export const splitRiskStream = (
  orders$: Observable<OrderNew>,
  limits: RiskLimits,
  clock?: Clock,
  accountGuard?: AccountExposureGuard
) => {
  const engine = createPreTradeRisk(limits, clock?.now ?? systemClock.now, accountGuard);
  const decisions$ = orders$.pipe(map((order) => engine(order)), share());
  const allowed$ = decisions$.pipe(filter((decision) => decision.allowed));
  const rejected$ = decisions$.pipe(filter((decision) => !decision.allowed));
  return [allowed$, rejected$];
};
