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
  notional?: number;
}

export interface AccountExposureGuard {
  venue: string;
  baseAsset: string;
  quoteAsset: string;
  getAvailable: (venue: string, asset: string) => number | null;
  reserve?: (orderId: string, amount: number) => void;
  consume?: (orderId: string, amount: number) => void;
  release?: (orderId: string) => void;
  inspect?: () => unknown;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const getReferencePx = (order: OrderNew) => {
  const px = numberOrNull(order.px);
  if (px !== null) return px;
  const meta = order.meta as Record<string, unknown> | undefined;
  const execPx = numberOrNull(meta?.execRefPx);
  return execPx ?? 0;
};

const getExpectedFeeRate = (order: OrderNew) => {
  const meta = order.meta as Record<string, unknown> | undefined;
  const feeBps = numberOrNull(meta?.expectedFeeBps);
  if (feeBps === null) return 0;
  return Math.max(0, feeBps) / 10_000;
};

export const createPreTradeRisk = (
  limits: RiskLimits,
  now: () => number = systemClock.now,
  accountGuard?: AccountExposureGuard,
  marketExposureGuard?: {
    updateMargin: (order: OrderNew) => void;
    canAccept: (order: OrderNew, notional: number) => boolean;
  }
) => {
  const exposures: Record<string, number> = {};
  let orderLog: Array<{ ts: number }> = [];

  const check = (order: OrderNew): RiskDecision => {
    const reasons: string[] = [];
    const meta = order.meta as Record<string, unknown> | undefined;
    const isExit = Boolean(meta?.exit);
    const referencePx = getReferencePx(order);
    const grossNotional = Math.abs(order.qty * referencePx);
    const feeRate = getExpectedFeeRate(order);
    const notionalWithFees = grossNotional * (1 + feeRate);
    if (!isExit && limits.notional && notionalWithFees > limits.notional) {
      reasons.push(`notional>${limits.notional}`);
    }

    const position = exposures[order.symbol] ?? 0;
    const next = position + (order.side === 'BUY' ? order.qty : -order.qty);
    if (Math.abs(next) > limits.maxPosition) {
      reasons.push(`position>${limits.maxPosition}`);
    }

    const band = limits.priceBands[order.symbol];
    if (!isExit && band && referencePx > 0) {
      if (referencePx < band.min || referencePx > band.max) {
        reasons.push('price-band');
      }
    }

    const ts = now();
    if (!isExit) {
      orderLog = orderLog.filter((entry) => ts - entry.ts <= limits.throttle.windowMs);
      if (orderLog.length >= limits.throttle.maxCount) {
        reasons.push('throttle');
      } else {
        orderLog.push({ ts });
      }
    }

    if (!isExit && accountGuard && !marketExposureGuard) {
      const venue = accountGuard.venue;
      if (order.side === 'BUY' && referencePx > 0) {
        const availableQuote = accountGuard.getAvailable(venue, accountGuard.quoteAsset);
        if (availableQuote !== null) {
          if (availableQuote < notionalWithFees) {
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

    if (!isExit && marketExposureGuard) {
      if (!marketExposureGuard.canAccept(order, notionalWithFees)) {
        reasons.push('insufficient-balance');
      }
    }

    const allowed = reasons.length === 0;
    if (allowed) {
      exposures[order.symbol] = next;
      marketExposureGuard?.updateMargin(order);
    }

    return {
      order,
      allowed,
      reasons: allowed ? undefined : reasons,
      notional: allowed ? notionalWithFees : undefined
    };
  };

  const revert = (order: OrderNew) => {
    const symbol = order.symbol;
    const position = exposures[symbol] ?? 0;
    const next = position - (order.side === 'BUY' ? order.qty : -order.qty);
    exposures[symbol] = next;
  };

  return { check, revert };
};

export const splitRiskStream = (
  orders$: Observable<OrderNew>,
  limits: RiskLimits,
  clock?: Clock,
  accountGuard?: AccountExposureGuard,
  marketExposureGuard?: { updateMargin: (order: OrderNew) => void; canAccept: (order: OrderNew, notional: number) => boolean },
  reconcile$?: Observable<OrderNew>
) => {
  const engine = createPreTradeRisk(
    limits,
    clock?.now ?? systemClock.now,
    accountGuard,
    marketExposureGuard
  );

  if (reconcile$) {
    reconcile$.subscribe((order) => {
      engine.revert(order);
    });
  }

  const decisions$ = orders$.pipe(map((order) => engine.check(order)), share());
  const allowed$ = decisions$.pipe(filter((decision) => decision.allowed));
  const rejected$ = decisions$.pipe(filter((decision) => !decision.allowed));
  return [allowed$, rejected$];
};
