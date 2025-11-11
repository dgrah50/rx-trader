import { filter, map, tap, withLatestFrom, shareReplay } from 'rxjs';
import type { Observable } from 'rxjs';
import type { StrategySignal } from '../types';
import type { MarketTick, OrderNew } from '@rx-trader/core/domain';

type Side = 'BUY' | 'SELL';

type RefType = 'BID' | 'ASK' | 'MID' | 'LAST' | 'LIMIT';

type IntentMode = 'market' | 'limit' | 'makerPreferred' | 'takerOnDrift';

interface ExecutionPolicy {
  mode: IntentMode;
  defaultQty?: number;
  notionalUsd?: number;
  limitOffsetBps?: number;
  minEdgeBps?: number;
  makerFeeBps?: number;
  takerFeeBps?: number;
  takerSlipBps?: number;
  adverseSelectionBps?: number;
  postOnly?: boolean;
  reduceOnly?: boolean;
  cooldownMs?: number;
  dedupeWindowMs?: number;
  makerTimeoutMs?: number;
  repriceBps?: number;
  tif?: OrderNew['tif'];
}

interface IntentBuilderOptions {
  account: string;
  policy: ExecutionPolicy;
  tickSize?: number;
  lotSize?: number;
  now?: () => number;
  strategyId?: string;
  feeSource?: string;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const roundToStep = (value: number, step?: number, dir: 'up' | 'down' | 'nearest' = 'nearest') => {
  if (!step || step <= 0) return value;
  const k = value / step;
  if (dir === 'nearest') return Math.round(k) * step;
  if (dir === 'down') return Math.floor(k) * step;
  return Math.ceil(k) * step;
};

const computeEdgeBps = (fairPx: number, execPx: number, side: Side) => {
  const sideSign = side === 'BUY' ? 1 : -1;
  return sideSign * ((fairPx - execPx) / execPx) * 10_000;
};

const selectTakerRef = (tick: MarketTick, side: Side): { px: number; type: RefType } | null => {
  const preferred = side === 'BUY' ? tick.ask : tick.bid;
  if (isNumber(preferred)) {
    return { px: preferred, type: side === 'BUY' ? 'ASK' : 'BID' };
  }
  if (isNumber(tick.last)) {
    return { px: tick.last, type: 'LAST' };
  }
  if (isNumber(tick.bid) && isNumber(tick.ask)) {
    return { px: (tick.bid + tick.ask) / 2, type: 'MID' };
  }
  return null;
};

const selectMakerAnchor = (tick: MarketTick, side: Side): { px: number; type: RefType } | null => {
  if (side === 'BUY' && isNumber(tick.bid)) {
    return { px: tick.bid, type: 'BID' };
  }
  if (side === 'SELL' && isNumber(tick.ask)) {
    return { px: tick.ask, type: 'ASK' };
  }
  if (isNumber(tick.bid) && isNumber(tick.ask)) {
    return { px: (tick.bid + tick.ask) / 2, type: 'MID' };
  }
  if (isNumber(tick.last)) {
    return { px: tick.last, type: 'LAST' };
  }
  return null;
};

type BuiltIntent = {
  order: OrderNew;
  netEdgeBps: number;
  intentType: 'MAKER' | 'TAKER';
};

export const createIntentBuilder = (opts: IntentBuilderOptions) => {
  const policy = {
    mode: opts.policy.mode,
    defaultQty: opts.policy.defaultQty ?? 1,
    notionalUsd: opts.policy.notionalUsd ?? 0,
    limitOffsetBps: opts.policy.limitOffsetBps ?? 0,
    minEdgeBps: opts.policy.minEdgeBps ?? 0,
    makerFeeBps: opts.policy.makerFeeBps ?? 0,
    takerFeeBps: opts.policy.takerFeeBps ?? 0,
    takerSlipBps: opts.policy.takerSlipBps ?? 0,
    adverseSelectionBps: opts.policy.adverseSelectionBps ?? 0,
    postOnly: opts.policy.postOnly ?? false,
    reduceOnly: opts.policy.reduceOnly ?? false,
    cooldownMs: opts.policy.cooldownMs ?? 0,
    dedupeWindowMs: opts.policy.dedupeWindowMs ?? 0,
    makerTimeoutMs: opts.policy.makerTimeoutMs ?? 0,
    repriceBps: opts.policy.repriceBps ?? 0,
    tif: opts.policy.tif ?? 'DAY'
  } as Required<ExecutionPolicy>;

  const tickCache = new Map<string, MarketTick>();
  const cooldownMap = new Map<string, number>();
  const dedupeMap = new Map<string, number>();
  const now = opts.now ?? (() => Date.now());

  const computeQty = (execRefPx: number) => {
    const target = policy.notionalUsd > 0 ? policy.notionalUsd / execRefPx : policy.defaultQty;
    return roundToStep(target, opts.lotSize, 'down');
  };

  const dedupeKeyFor = (order: OrderNew) => {
    const price = order.type === 'MKT' ? 'MKT' : order.px?.toFixed(8) ?? '0';
    return `${order.symbol}:${order.side}:${order.type}:${price}:${order.qty}`;
  };

  const finalizeOrder = (
    order: OrderNew,
    meta: Record<string, unknown>,
    timestamp: number
  ): OrderNew | null => {
    const cooldownKey = `${order.symbol}:${order.side}`;
    if (policy.cooldownMs > 0) {
      const last = cooldownMap.get(cooldownKey);
      if (last !== undefined && timestamp - last < policy.cooldownMs) {
        return null;
      }
    }

    if (policy.dedupeWindowMs > 0) {
      const dKey = dedupeKeyFor(order);
      const last = dedupeMap.get(dKey);
      if (last !== undefined && timestamp - last < policy.dedupeWindowMs) {
        return null;
      }
      dedupeMap.set(dKey, timestamp);
      meta.dedupeKey = dKey;
    }

    if (policy.cooldownMs > 0) {
      cooldownMap.set(cooldownKey, timestamp);
    }

    order.meta = {
      ...(order.meta ?? {}),
      ...meta,
      mode: policy.mode,
      postOnly: policy.postOnly,
      reduceOnly: policy.reduceOnly,
      ...(opts.strategyId ? { strategyId: opts.strategyId } : {})
    };

    return order;
  };

  const buildTakerOrder = (
    signal: StrategySignal,
    tick: MarketTick,
    timestamp: number,
    reason: string
  ): BuiltIntent | null => {
    const ref = selectTakerRef(tick, signal.action as Side);
    if (!ref) return null;

    const slipBps = policy.takerSlipBps;
    const slipFactor = 1 + (slipBps / 10_000) * (signal.action === 'BUY' ? 1 : -1);
    const execRefPx = ref.px * slipFactor;
    if (execRefPx <= 0) return null;

    const edgeBps = computeEdgeBps(signal.px, execRefPx, signal.action as Side);
    const feeBps = policy.takerFeeBps;
    const required = policy.minEdgeBps + feeBps + policy.takerSlipBps;
    if (edgeBps < required) return null;

    const qty = computeQty(execRefPx);
    if (qty <= 0) return null;

    const order: OrderNew = {
      id: crypto.randomUUID(),
      t: timestamp,
      symbol: signal.symbol,
      side: signal.action,
      qty,
      type: 'MKT',
      tif: policy.tif,
      account: opts.account,
      meta: {}
    };

    const finalized = finalizeOrder(
      order,
      {
        reason,
        refType: ref.type,
        fairPx: signal.px,
        execRefPx,
        gateBps: required,
        edgeBps,
        feedTs: tick.t,
        netEdgeBps: edgeBps - required,
        liquidity: 'TAKER',
        expectedFeeBps: feeBps,
        feeSource: opts.feeSource ?? 'policy'
      },
      timestamp
    );

    if (!finalized) return null;

    return {
      order: finalized,
      netEdgeBps: edgeBps - required,
      intentType: 'TAKER'
    };
  };

  const buildMakerOrder = (
    signal: StrategySignal,
    tick: MarketTick,
    timestamp: number,
    reason: string
  ): BuiltIntent | null => {
    const anchor = selectMakerAnchor(tick, signal.action as Side);
    if (!anchor) return null;

    const offset = policy.limitOffsetBps / 10_000;
    const rawPx = signal.action === 'BUY'
      ? anchor.px * (1 - offset)
      : anchor.px * (1 + offset);
    let px = roundToStep(rawPx, opts.tickSize, signal.action === 'BUY' ? 'down' : 'up');
    if (px <= 0) return null;

    if (policy.postOnly) {
      if (signal.action === 'BUY' && isNumber(tick.ask) && px >= tick.ask) {
        return null;
      }
      if (signal.action === 'SELL' && isNumber(tick.bid) && px <= tick.bid) {
        return null;
      }
    }

    const execRefPx = px;
    const edgeBps = computeEdgeBps(signal.px, execRefPx, signal.action as Side);
    const feeBps = policy.makerFeeBps;
    const required = policy.minEdgeBps + feeBps + policy.adverseSelectionBps;
    if (edgeBps < required) {
      return null;
    }

    const qty = computeQty(execRefPx);
    if (qty <= 0) return null;

    const order: OrderNew = {
      id: crypto.randomUUID(),
      t: timestamp,
      symbol: signal.symbol,
      side: signal.action,
      qty,
      type: 'LMT',
      px,
      tif: policy.tif,
      account: opts.account,
      meta: {}
    };

    const finalized = finalizeOrder(
      order,
      {
        reason,
        refType: 'LIMIT' as RefType,
        anchorType: anchor.type,
        fairPx: signal.px,
        execRefPx,
        gateBps: required,
        edgeBps,
        feedTs: tick.t,
        netEdgeBps: edgeBps - required,
        liquidity: 'MAKER',
        expectedFeeBps: feeBps,
        feeSource: opts.feeSource ?? 'policy'
      },
      timestamp
    );

    if (!finalized) return null;

    return {
      order: finalized,
      netEdgeBps: edgeBps - required,
      intentType: 'MAKER'
    };
  };

  return (signals$: Observable<StrategySignal>, marks$: Observable<MarketTick>) => {
    const sharedMarks$ = marks$.pipe(
      tap((tick) => tickCache.set(tick.symbol, tick)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    return signals$.pipe(
      withLatestFrom(sharedMarks$),
      map(([signal]) => {
        const tick = tickCache.get(signal.symbol);
        if (!tick) {
          return null;
        }
        const timestamp = now();

        if (policy.mode === 'market' || policy.mode === 'takerOnDrift') {
          return buildTakerOrder(signal, tick, timestamp, 'TAKER_EDGE_OK')?.order ?? null;
        }
        if (policy.mode === 'limit') {
          return buildMakerOrder(signal, tick, timestamp, 'MAKER_EDGE_OK')?.order ?? null;
        }
        if (policy.mode === 'makerPreferred') {
          const maker = buildMakerOrder(signal, tick, timestamp, 'MAKER_EDGE_OK');
          const taker = buildTakerOrder(signal, tick, timestamp, 'MAKER_FALLBACK_TAKER');
          const candidates = [maker, taker].filter(
            (candidate): candidate is BuiltIntent => candidate !== null
          );
          if (!candidates.length) {
            return null;
          }
          candidates.sort((a, b) => b.netEdgeBps - a.netEdgeBps);
          return candidates[0]!.order;
        }
        return null;
      }),
      filter((order): order is OrderNew => order !== null)
    );
  };
};
