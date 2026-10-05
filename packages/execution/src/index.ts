import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import type {
  DomainEvent,
  OrderNew,
  OrderAck,
  OrderReject,
  OrderCancelReq,
} from '@rx-trader/core/domain';
import { ExecutionVenue } from '@rx-trader/core/constants';
import { deterministicUuid } from '@rx-trader/core/integrity';
import { createHmac } from 'node:crypto';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ExecutionRetryError extends Error {
  public readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.retryable = retryable;
  }
}

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  jitter: 0.3,
};

const withRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = DEFAULT_RETRY_OPTIONS,
) => {
  let attempt = 0;
  let lastError: Error | undefined;
  while (attempt < options.maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt += 1;
      const retryable = (error as ExecutionRetryError)?.retryable ?? true;
      if (!retryable || attempt >= options.maxAttempts) {
        throw lastError;
      }
      const backoff = Math.min(options.maxDelayMs, options.baseDelayMs * Math.pow(2, attempt - 1));
      const jitterRange = backoff * options.jitter;
      const jitteredDelay = backoff + (Math.random() * 2 - 1) * jitterRange;
      await delay(Math.max(options.baseDelayMs, jitteredDelay));
    }
  }
  throw lastError ?? new Error('Retry attempts exhausted');
};

const shouldRetryStatus = (status: number) => status >= 500 || status === 429;

type ExecEvent = DomainEvent<'order.ack' | 'order.reject' | 'order.fill' | 'order.cancel'>;

export interface ExecutionAdapter {
  id: string;
  submit(order: OrderNew): Promise<void>;
  cancel(orderId: string): Promise<void>;
  events$: Observable<ExecEvent>;
}

abstract class BaseExecutionAdapter implements ExecutionAdapter {
  public readonly id: string;
  public readonly events$ = new Subject<ExecEvent>();
  protected readonly clock: Clock;

  protected constructor(id: string, clock: Clock = systemClock) {
    this.id = id;
    this.clock = clock;
  }

  protected ack(orderId: string, ts = this.clock.now()) {
    const payload: OrderAck = { id: orderId, t: ts, venue: this.id };
    const dedupeKey = `order.ack:${this.id}:${orderId}`;
    this.events$.next({
      id: deterministicUuid(`event:${dedupeKey}`),
      dedupeKey,
      type: 'order.ack',
      ts,
      data: payload,
    });
  }

  protected fill(
    order: OrderNew,
    overrides: Partial<OrderNew> & {
      executionIndex?: number;
      venueOrderId?: string;
      venueTradeId?: string;
    } = {},
    ts = this.clock.now(),
  ) {
    const executionIdentity =
      overrides.venueTradeId ?? `${order.id}:${overrides.executionIndex ?? 0}`;
    const dedupeKey = `order.fill:${this.id}:${executionIdentity}`;
    const fillId = deterministicUuid(`fill:${this.id}:${executionIdentity}`);
    this.events$.next({
      id: deterministicUuid(`event:${dedupeKey}`),
      dedupeKey,
      type: 'order.fill',
      ts,
      data: {
        id: fillId,
        venueTradeId: overrides.venueTradeId,
        venueOrderId: overrides.venueOrderId,
        orderId: order.id,
        t: ts,
        symbol: overrides.symbol ?? order.symbol,
        px: overrides.px ?? order.px ?? 100,
        qty: overrides.qty ?? order.qty,
        side: overrides.side ?? order.side,
      },
    } as ExecEvent);
  }

  protected cancelEvent(orderId: string, ts = this.clock.now()) {
    const payload: OrderCancelReq = { id: orderId, t: ts };
    const dedupeKey = `order.cancel:${this.id}:${orderId}`;
    this.events$.next({
      id: deterministicUuid(`event:${dedupeKey}`),
      dedupeKey,
      type: 'order.cancel',
      ts,
      data: payload,
    } as ExecEvent);
  }

  protected reject(orderId: string, reason: string, ts = this.clock.now()) {
    const payload: OrderReject = { id: orderId, t: ts, reason };
    const dedupeKey = `order.reject:${this.id}:${orderId}`;
    this.events$.next({
      id: deterministicUuid(`event:${dedupeKey}`),
      dedupeKey,
      type: 'order.reject',
      ts,
      data: payload,
    });
  }

  abstract submit(order: OrderNew): Promise<void>;

  async cancel(orderId: string) {
    this.cancelEvent(orderId);
  }
}

export class PaperExecutionAdapter extends BaseExecutionAdapter {
  constructor(id: string, clock?: Clock) {
    super(id, clock);
  }

  /** Synthetic paper fills; this does not model an exchange order book. */
  async submit(order: OrderNew) {
    const baseLatencyMs = 50;
    const jitterMs = Math.random() * 100;
    const latencyMs = baseLatencyMs + jitterMs;

    await delay(latencyMs * 0.3);
    this.ack(order.id, this.clock.now());

    const metaPx = order.meta?.execRefPx;
    const refPrice = metaPx ?? order.px ?? 100;

    let fillPrice = refPrice;

    if (order.type === 'MKT') {
      const spreadBps = 2 + Math.random() * 3;
      const slippageBps = spreadBps * (0.5 + Math.random());
      const slippagePct = slippageBps / 10000;

      fillPrice =
        order.side === 'BUY' ? refPrice * (1 + slippagePct) : refPrice * (1 - slippagePct);
    } else {
      const improvementBps = Math.random();
      const improvementPct = improvementBps / 10000;

      fillPrice =
        order.side === 'BUY' ? refPrice * (1 - improvementPct) : refPrice * (1 + improvementPct);
    }

    await delay(latencyMs * 0.7);
    this.fill(order, { px: fillPrice }, this.clock.now());
  }
}

export class BinanceMockGateway extends BaseExecutionAdapter {
  constructor(id: string = ExecutionVenue.Binance, clock?: Clock) {
    super(id, clock);
  }

  async submit(order: OrderNew) {
    const ts = this.clock.now();
    this.ack(order.id, ts);
    const expectedPx = Number(
      typeof order.meta?.expectedPx === 'number' ? order.meta.expectedPx : NaN,
    );
    const price = order.px ?? (Number.isFinite(expectedPx) ? expectedPx : 100);
    this.fill(order, { px: price }, ts + 5);
  }
}

export class HyperliquidMockGateway extends BaseExecutionAdapter {
  constructor(id: string = ExecutionVenue.Hyperliquid, clock?: Clock) {
    super(id, clock);
  }

  async submit(order: OrderNew) {
    const ts = this.clock.now();
    this.ack(order.id, ts);
    const slippage = 0.5 * (order.side === 'BUY' ? 1 : -1);
    const px = (order.px ?? 100) + slippage;
    this.fill(order, { px }, ts + 10);
  }
}

export interface BinanceRestGatewayConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
}

export class BinanceRestGateway extends BaseExecutionAdapter {
  private readonly baseUrl: string;
  private readonly orderSymbols = new Map<string, string>();

  constructor(
    private readonly config: BinanceRestGatewayConfig,
    clock?: Clock,
  ) {
    super(ExecutionVenue.Binance, clock);
    this.baseUrl = config.baseUrl ?? 'https://api.binance.com';
  }

  private sign(params: URLSearchParams) {
    const signature = createHmac('sha256', this.config.apiSecret)
      .update(params.toString())
      .digest('hex');
    params.set('signature', signature);
  }

  private buildOrderParams(order: OrderNew) {
    const params = new URLSearchParams({
      symbol: order.symbol.toUpperCase(),
      side: order.side,
      type: order.type === 'LMT' ? 'LIMIT' : 'MARKET',
      quantity: order.qty.toString(),
      timestamp: this.clock.now().toString(),
    });
    if (order.type === 'LMT') {
      params.set('price', (order.px ?? 0).toString());
      params.set('timeInForce', 'GTC');
    }
    return params;
  }

  async submit(order: OrderNew) {
    try {
      const params = this.buildOrderParams(order);
      this.sign(params);
      const response = await withRetry(async () => {
        const res = await fetch(`${this.baseUrl}/api/v3/order`, {
          method: 'POST',
          headers: {
            'X-MBX-APIKEY': this.config.apiKey,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });
        if (!res.ok) {
          const payload = await res.text();
          const reason = payload || res.statusText;
          if (shouldRetryStatus(res.status)) {
            throw new ExecutionRetryError(`Binance retryable error: ${reason}`, true);
          }
          throw new ExecutionRetryError(reason, false);
        }
        return res;
      });
      const data = (await response.json()) as {
        orderId?: number | string;
        transactTime?: number;
        status?: string;
        price?: string | number;
        avgPrice?: string | number;
      };
      this.orderSymbols.set(order.id, order.symbol.toUpperCase());
      const ts = data.transactTime ?? this.clock.now();
      this.ack(order.id, ts);
      if (data.status === 'FILLED') {
        const px = Number(data.price) || order.px || Number(data.avgPrice) || 0;
        const venueOrderId = data.orderId === undefined ? undefined : String(data.orderId);
        this.fill(
          order,
          {
            px,
            venueOrderId,
            venueTradeId: venueOrderId ? `order:${venueOrderId}:aggregate` : undefined,
          },
          ts,
        );
      }
    } catch (error) {
      const reason =
        error instanceof ExecutionRetryError
          ? error.message
          : ((error as Error)?.message ?? 'Submit failed');
      this.reject(order.id, reason);
      throw error;
    }
  }

  override async cancel(orderId: string) {
    const symbol = this.orderSymbols.get(orderId);
    if (!symbol) {
      throw new Error(`Unknown order symbol for ${orderId}`);
    }
    const params = new URLSearchParams({
      symbol,
      timestamp: this.clock.now().toString(),
      origClientOrderId: orderId,
    });
    this.sign(params);
    await withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/api/v3/order?${params.toString()}`, {
        method: 'DELETE',
        headers: {
          'X-MBX-APIKEY': this.config.apiKey,
        },
      });
      if (!res.ok) {
        const payload = await res.text();
        const reason = payload || res.statusText;
        if (shouldRetryStatus(res.status)) {
          throw new ExecutionRetryError(`Binance cancel retryable error: ${reason}`, true);
        }
        throw new ExecutionRetryError(reason, false);
      }
    });
    this.cancelEvent(orderId);
  }
}
