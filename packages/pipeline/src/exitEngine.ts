import { EMPTY, Subject, type Observable, type Subscription } from 'rxjs';
import type { ExitConfig } from '@rx-trader/config';
import type { OrderNew, PortfolioAnalytics, PortfolioSnapshot } from '@rx-trader/core/domain';
import type { Clock } from '@rx-trader/core/time';
import type { PricePoint, StrategySignal } from '@rx-trader/strategies';

export interface ExitEngineOptions {
  strategyId: string;
  symbol: string;
  accountId: string;
  exit: ExitConfig;
  clock: Clock;
  positions$: Observable<PortfolioSnapshot['positions'][string] | null>;
  price$: Observable<PricePoint>;
  signals$?: Observable<StrategySignal>;
  analytics$?: Observable<PortfolioAnalytics>;
}

export interface ExitEngineHandle {
  exitIntents$: Observable<OrderNew>;
  stop: () => void;
}

interface PositionState {
  qty: number;
  avgPx: number;
  notional: number;
  entryTime: number;
  direction: 'LONG' | 'SHORT';
}

interface TrailingState {
  armed: boolean;
  peakPx: number | null;
  troughPx: number | null;
}

interface Decision {
  reason: string;
  action: 'CLOSE_LONG' | 'CLOSE_SHORT' | 'FLATTEN';
}

class RollingStd {
  private readonly returns: number[] = [];
  private prevPx: number | null = null;

  constructor(private readonly capacity: number) {}

  update(price: number): number {
    if (this.prevPx !== null && this.prevPx > 0) {
      const ret = Math.log(price / this.prevPx);
      this.returns.push(ret);
      if (this.returns.length > this.capacity) {
        this.returns.shift();
      }
    }
    this.prevPx = price;
    return this.std();
  }

  std(): number {
    if (this.returns.length < 2) return 0;
    const mean = this.returns.reduce((sum, v) => sum + v, 0) / this.returns.length;
    const variance =
      this.returns.reduce((sum, v) => {
        const d = v - mean;
        return sum + d * d;
      }, 0) / this.returns.length;
    return Math.sqrt(variance);
  }
}

export const createExitEngine = (options: ExitEngineOptions): ExitEngineHandle => {
  if (!options.exit.enabled) {
    return { exitIntents$: EMPTY, stop: () => {} };
  }

  const debugExits = (process.env.DEBUG_E2E ?? '').toLowerCase() === 'true';
  const debugLog = (...args: unknown[]) => {
    if (debugExits) {
      console.log('[exit-engine]', ...args);
    }
  };

  const exitSubject = new Subject<OrderNew>();
  debugLog('initialized', {
    strategyId: options.strategyId,
    symbol: options.symbol,
    exit: options.exit
  });
  const subs: Subscription[] = [];

  const sigmaLookbackSec = options.exit.tpSl?.sigmaLookbackSec ?? 300;
  const sigmaWindow = Math.max(10, Math.round(sigmaLookbackSec / 2));
  const sigmaEstimator = new RollingStd(sigmaWindow);

  let position: PositionState | null = null;
  let trailing: TrailingState = { armed: false, peakPx: null, troughPx: null };
  let currentPrice: PricePoint | null = null;
  let lastSignal: StrategySignal | null = null;
  let analytics: PortfolioAnalytics | null = null;
  let pendingExit: string | null = null;

  const resetTrailing = () => {
    trailing = { armed: false, peakPx: null, troughPx: null };
  };

  const resetState = () => {
    position = null;
    pendingExit = null;
    resetTrailing();
  };

  const deriveCurrentPosition = (pos: PortfolioSnapshot['positions'][string] | null) => {
    if (!pos || pos.pos === 0) {
      resetState();
      return;
    }
    const direction: 'LONG' | 'SHORT' = pos.pos > 0 ? 'LONG' : 'SHORT';
    const wasFlat = !position || position.qty === 0;
    const sameDirection = position?.direction === direction;
    const entryTime = wasFlat || !sameDirection ? pos.t ?? options.clock.now() : position!.entryTime;
    const notional = pos.notional ?? pos.px * pos.pos;
    const nextState: PositionState = {
      qty: Math.abs(pos.pos),
      avgPx: pos.avgPx,
      notional: Math.abs(notional),
      entryTime,
      direction
    };

    if (!position || position.direction !== nextState.direction || position.qty === 0) {
      resetTrailing();
      pendingExit = null;
    }
    position = nextState;
  };

  const determineSide = (decision: Decision, direction: PositionState['direction']) => {
    if (decision.action === 'FLATTEN') {
      return direction === 'LONG' ? 'SELL' : 'BUY';
    }
    if (decision.action === 'CLOSE_LONG') return 'SELL';
    return 'BUY';
  };

  const emitExit = (decision: Decision) => {
    if (!position || !currentPrice) return;
    if (pendingExit && pendingExit === decision.reason) return;
    const qty = position.qty;
    if (qty <= 0) return;
    const side = determineSide(decision, position.direction);
    const order: OrderNew = {
      id: crypto.randomUUID(),
      t: options.clock.now(),
      symbol: options.symbol,
      side,
      qty,
      type: 'MKT',
      tif: 'IOC',
      account: options.accountId,
      meta: {
        exit: true,
        reason: decision.reason,
        strategyId: options.strategyId,
        px: currentPrice.px
      }
    };
    pendingExit = decision.reason;
    exitSubject.next(order);
  };

  const evaluate = () => {
    if (!position || !currentPrice) return;
    const now = options.clock.now();
    const decision =
      evaluateRisk(position, analytics, options.exit, currentPrice) ||
      evaluateTime(position, options.exit, now) ||
      evaluateFairValue(position, currentPrice, options.exit, lastSignal, now) ||
      evaluateTpSl(position, currentPrice, options.exit, sigmaEstimator.std()) ||
      evaluateTrailing(position, currentPrice, options.exit, trailing, sigmaEstimator.std());
    if (decision) {
      debugLog('decision', decision.reason, { position, price: currentPrice });
      emitExit(decision);
    }
  };

  subs.push(
    options.positions$.subscribe((pos) => {
      debugLog('position update', pos);
      deriveCurrentPosition(pos);
      evaluate();
    })
  );

  subs.push(
    options.price$.subscribe((price) => {
      debugLog('price update', price);
      currentPrice = price;
      sigmaEstimator.update(price.px);
      updateTrailingState(trailing, position, price);
      evaluate();
    })
  );

  if (options.signals$) {
    subs.push(
      options.signals$.subscribe((signal) => {
        debugLog('signal update', signal);
        if (signal.symbol === options.symbol) {
          lastSignal = signal;
          evaluate();
        }
      })
    );
  }

  if (options.analytics$) {
    subs.push(
      options.analytics$.subscribe((snapshot) => {
        analytics = snapshot;
        evaluate();
      })
    );
  }

  const stop = () => {
    subs.forEach((sub) => sub.unsubscribe());
    exitSubject.complete();
  };

  return {
    exitIntents$: exitSubject.asObservable(),
    stop
  } satisfies ExitEngineHandle;
};

const evaluateRisk = (
  position: PositionState,
  analytics: PortfolioAnalytics | null,
  config: ExitConfig,
  price: PricePoint
): Decision | null => {
  if (!config.riskOverrides) return null;
  const overrides = config.riskOverrides;
  const action: Decision['action'] = position.direction === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
  const exposure = position.notional;
  if (overrides.maxSymbolExposureUsd && exposure > overrides.maxSymbolExposureUsd) {
    return { reason: 'EXIT_RISK_SYMBOL', action };
  }

  if (analytics) {
    const gross = Object.values(analytics.symbols).reduce((sum, sym) => sum + Math.abs(sym.notional), 0);
    if (overrides.maxGrossExposureUsd && gross > overrides.maxGrossExposureUsd) {
      return { reason: 'EXIT_RISK_GROSS', action: overrides.action === 'FLATTEN_ALL' ? 'FLATTEN' : action };
    }
    if (overrides.maxDrawdownPct && Math.abs(analytics.drawdownPct) > overrides.maxDrawdownPct) {
      return { reason: 'EXIT_RISK_DRAWDOWN', action: overrides.action === 'FLATTEN_ALL' ? 'FLATTEN' : action };
    }
    if (overrides.marginBufferPct && analytics.nav > 0) {
      const remaining = (analytics.nav - exposure) / analytics.nav;
      if (remaining < overrides.marginBufferPct) {
        return { reason: 'EXIT_RISK_MARGIN', action: overrides.action === 'FLATTEN_ALL' ? 'FLATTEN' : action };
      }
    }
  }
  return null;
};

const evaluateTime = (position: PositionState, config: ExitConfig, now: number): Decision | null => {
  if (!config.time?.enabled || position.entryTime == null) return null;
  if (config.time.minHoldMs && now - position.entryTime < config.time.minHoldMs) {
    return null;
  }
  if (config.time.maxHoldMs && now - position.entryTime >= config.time.maxHoldMs) {
    const action: Decision['action'] = position.direction === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
    return { reason: 'EXIT_TIME', action };
  }
  return null;
};

const evaluateFairValue = (
  position: PositionState,
  price: PricePoint,
  config: ExitConfig,
  signal: StrategySignal | null,
  now: number
): Decision | null => {
  if (!config.fairValue?.enabled) return null;
  if (position.entryTime == null) return null;
  const action: Decision['action'] = position.direction === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
  const timeHeld = now - position.entryTime;
  if (config.time?.minHoldMs && timeHeld < config.time.minHoldMs) {
    return null;
  }
  if (config.fairValue.closeOnSignalFlip && signal) {
    if ((position.direction === 'LONG' && signal.action === 'SELL') || (position.direction === 'SHORT' && signal.action === 'BUY')) {
      return { reason: 'EXIT_SIGNAL_FLIP', action };
    }
  }
  if (config.fairValue.epsilonBps && signal?.px) {
    const diffBps = Math.abs(price.px - signal.px) / signal.px * 10_000;
    if (diffBps <= config.fairValue.epsilonBps) {
      return { reason: 'EXIT_FAIR_VALUE', action };
    }
  }
  return null;
};

const evaluateTpSl = (
  position: PositionState,
  price: PricePoint,
  config: ExitConfig,
  sigma: number
): Decision | null => {
  if (!config.tpSl?.enabled || sigma <= 0) return null;
  const tpSigma = config.tpSl.tpSigma ?? 1.5;
  const slSigma = config.tpSl.slSigma ?? 1.0;
  const priceChange = (price.px - position.avgPx) / position.avgPx;
  const action: Decision['action'] = position.direction === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
  const direction = position.direction === 'LONG' ? 1 : -1;
  if (priceChange * direction >= tpSigma * sigma) {
    return { reason: 'EXIT_TP', action };
  }
  if (priceChange * direction <= -slSigma * sigma) {
    return { reason: 'EXIT_SL', action };
  }
  return null;
};

const evaluateTrailing = (
  position: PositionState,
  price: PricePoint,
  config: ExitConfig,
  trailing: TrailingState,
  sigma: number
): Decision | null => {
  if (!config.trailing?.enabled) return null;
  const action: Decision['action'] = position.direction === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
  const retracePct = config.trailing.retracePct ?? 0.4;
  const armSigma = config.trailing.initArmPnLs ?? 1.0;
  const priceChange = (price.px - position.avgPx) / position.avgPx;
  const direction = position.direction === 'LONG' ? 1 : -1;
  const favorable = priceChange * direction;
  if (!trailing.armed && sigma > 0 && favorable >= armSigma * sigma) {
    trailing.armed = true;
    trailing.peakPx = price.px;
    trailing.troughPx = price.px;
  }
  if (!trailing.armed) return null;
  if (position.direction === 'LONG') {
    if (!trailing.peakPx || price.px > trailing.peakPx) {
      trailing.peakPx = price.px;
    }
    if (trailing.peakPx && (trailing.peakPx - price.px) / trailing.peakPx >= retracePct) {
      return { reason: 'EXIT_TRAIL', action };
    }
  } else {
    if (!trailing.troughPx || price.px < trailing.troughPx) {
      trailing.troughPx = price.px;
    }
    if (trailing.troughPx && (price.px - trailing.troughPx) / trailing.troughPx >= retracePct) {
      return { reason: 'EXIT_TRAIL', action };
    }
  }
  return null;
};

const updateTrailingState = (
  trailing: TrailingState,
  position: PositionState | null,
  price: PricePoint
) => {
  if (!position || !trailing.armed) return;
  if (position.direction === 'LONG') {
    if (!trailing.peakPx || price.px > trailing.peakPx) {
      trailing.peakPx = price.px;
    }
  } else {
    if (!trailing.troughPx || price.px < trailing.troughPx) {
      trailing.troughPx = price.px;
    }
  }
};
