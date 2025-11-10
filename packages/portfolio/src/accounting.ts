import type { Observable, Subscription } from 'rxjs';
import type { Fill } from '@rx-trader/core/domain';
import { accountBalanceAdjustedSchema } from '@rx-trader/core/domain';
import type { Clock } from '@rx-trader/core/time';
import { safeParse } from '@rx-trader/core/validation';

interface FillAccountingOptions {
  fills$: Observable<Fill>;
  baseAsset?: string;
  quoteAsset?: string;
  accountId: string;
  venue: string;
  enqueue: (event: {
    id: string;
    type: 'account.balance.adjusted';
    data: unknown;
    ts: number;
  }) => void;
  clock: Clock;
}

export const wireFillAccounting = (options: FillAccountingOptions): (() => void) => {
  const { fills$, baseAsset, quoteAsset } = options;
  if (!baseAsset || !quoteAsset) {
    return () => {};
  }
  const venueId = normalizeVenue(options.venue);
  const subscription: Subscription = fills$.subscribe((fill) => {
    const px = fill.px ?? 0;
    if (!Number.isFinite(px) || px <= 0) {
      return;
    }
    const ts = fill.t ?? options.clock.now();
    const accountId = options.accountId;

    const emit = (asset: string, delta: number, direction: string) => {
      if (!asset || !Number.isFinite(delta) || delta === 0) {
        return;
      }
      const payload = safeParse(
        accountBalanceAdjustedSchema,
        {
          id: crypto.randomUUID(),
          t: ts,
          accountId,
          venue: venueId,
          asset,
          delta,
          reason: 'fill',
          metadata: {
            fillId: fill.id,
            orderId: fill.orderId,
            direction
          }
        },
        { force: true }
      );
      options.enqueue({
        id: crypto.randomUUID(),
        type: 'account.balance.adjusted',
        data: payload,
        ts: payload.t
      });
    };

    if (fill.side === 'BUY') {
      emit(baseAsset, fill.qty, 'BASE_CREDIT');
      emit(quoteAsset, -fill.qty * px, 'QUOTE_DEBIT');
    } else {
      emit(baseAsset, -fill.qty, 'BASE_DEBIT');
      emit(quoteAsset, fill.qty * px, 'QUOTE_CREDIT');
    }
  });

  return () => subscription.unsubscribe();
};

const normalizeVenue = (value: string) => {
  const lower = (value ?? '').toLowerCase();
  if (lower.includes('binance')) return 'binance';
  if (lower.includes('hyperliquid')) return 'hyperliquid';
  if (lower.includes('paper')) return 'paper';
  return value ?? 'paper';
};
