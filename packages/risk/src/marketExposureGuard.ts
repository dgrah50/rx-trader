import type { OrderNew } from '@rx-trader/core/domain';

export interface MarketExposureGuardOptions {
  productType: 'SPOT' | 'PERP' | string;
  venue: string;
  baseAsset: string;
  quoteAsset: string;
  getAvailable: (venue: string, asset: string) => number; // returns 0 if unknown
  leverageCap?: number; // e.g. 1 = 100% initial margin requirement
}

export interface MarketExposureGuardHandle {
  updateMargin: (order: OrderNew) => void;
  canAccept: (order: OrderNew, notional: number) => boolean;
  inspect?: () => {
    mode: 'cash' | 'margin' | 'perp';
    productType: 'SPOT' | 'PERP';
    leverageCap: number;
    committed: number;
    collateral: number;
    availableBudget: number;
  };
}

export const createMarketExposureGuard = (opts: MarketExposureGuardOptions): MarketExposureGuardHandle => {
  const leverage = Math.max(1, Math.floor(opts.leverageCap ?? 1));
  let committedMargin = 0; // simple running budget for PERP

  const isSpot = String(opts.productType).toUpperCase() === 'SPOT' || !opts.productType;
  const isPerp = String(opts.productType).toUpperCase() === 'PERP';
  const mode: 'cash' | 'margin' | 'perp' = isPerp ? 'perp' : isSpot && leverage > 1 ? 'margin' : 'cash';

  const canAccept = (order: OrderNew, notional: number): boolean => {
    if (isSpot) {
      if (leverage > 1) {
        // Spot margin mode: allow both BUY and SELL up to margin budget
        const quote = opts.getAvailable(opts.venue, opts.quoteAsset) ?? 0;
        const budget = quote * leverage - committedMargin;
        return notional <= budget + 1e-9;
      } else {
        // Cash spot: must hold inventory for SELL, BUY handled elsewhere
        if (order.side === 'SELL') {
          const base = opts.getAvailable(opts.venue, opts.baseAsset) ?? 0;
          return base >= order.qty;
        }
        return true;
      }
    }

    if (isPerp) {
      const quote = opts.getAvailable(opts.venue, opts.quoteAsset) ?? 0;
      const budget = quote * leverage - committedMargin;
      return notional <= budget + 1e-9; // allow tiny epsilon
    }

    // Unknown product: default to conservative spot rules
    if (order.side === 'SELL') {
      const base = opts.getAvailable(opts.venue, opts.baseAsset) ?? 0;
      return base >= order.qty;
    }
    return true;
  };

  const updateMargin = (order: OrderNew) => {
    if (!(isPerp || (isSpot && leverage > 1))) return;
    const px = order.px ?? (typeof (order.meta as any)?.execRefPx === 'number' ? (order.meta as any).execRefPx : 0);
    const notional = Math.abs(order.qty * px);
    if (notional > 0) committedMargin += notional;
  };

  const inspect = () => {
    const collateral = opts.getAvailable(opts.venue, opts.quoteAsset) ?? 0;
    const availableBudget = mode === 'cash' ? 0 : collateral * leverage - committedMargin;
    const productType: 'SPOT' | 'PERP' = isPerp ? 'PERP' : 'SPOT';
    return {
      mode,
      productType,
      leverageCap: leverage,
      committed: committedMargin,
      collateral,
      availableBudget
    };
  };

  return { updateMargin, canAccept, inspect };
};
