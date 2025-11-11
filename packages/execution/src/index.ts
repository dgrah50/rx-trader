import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import type {
  DomainEvent,
  OrderNew,
  OrderAck,
  OrderReject,
  OrderCancelReq
} from '@rx-trader/core/domain';
import { ExecutionVenue } from '@rx-trader/core/constants';
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
  jitter: 0.3
};

const withRetry = async <T>(fn: () => Promise<T>, options: RetryOptions = DEFAULT_RETRY_OPTIONS) => {
  let attempt = 0;
  let lastError: unknown;
  while (attempt < options.maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt += 1;
      const retryable = (error as ExecutionRetryError)?.retryable ?? true;
      if (!retryable || attempt >= options.maxAttempts) {
        throw error;
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
    this.events$.next({
      id: crypto.randomUUID(),
      type: 'order.ack',
      ts,
      data: payload
    });
  }

  protected fill(order: OrderNew, overrides: Partial<OrderNew> = {}, ts = this.clock.now()) {
    this.events$.next({
      id: crypto.randomUUID(),
      type: 'order.fill',
      ts,
      data: {
        id: crypto.randomUUID(),
        orderId: order.id,
        t: ts,
        symbol: overrides.symbol ?? order.symbol,
        px: overrides.px ?? order.px ?? 100,
        qty: overrides.qty ?? order.qty,
        side: overrides.side ?? order.side
      }
    } as ExecEvent);
  }

  protected cancelEvent(orderId: string, ts = this.clock.now()) {
    const payload: OrderCancelReq = { id: orderId, t: ts };
    this.events$.next({
      id: crypto.randomUUID(),
      type: 'order.cancel',
      ts,
      data: payload
    } as ExecEvent);
  }

  protected reject(orderId: string, reason: string, ts = this.clock.now()) {
    const payload: OrderReject = { id: orderId, t: ts, reason };
    this.events$.next({
      id: crypto.randomUUID(),
      type: 'order.reject',
      ts,
      data: payload
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

  async submit(order: OrderNew) {
    const ts = this.clock.now();
    this.ack(order.id, ts);
    const metaRecord = order.meta as Record<string, unknown> | undefined;
    const metaPx = typeof metaRecord?.execRefPx === 'number' ? (metaRecord.execRefPx as number) : undefined;
    const px = metaPx ?? order.px;
    this.fill(
      order,
      px
        ? {
            px
          }
        : {},
      ts
    );
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
      typeof order.meta?.expectedPx === 'number' ? order.meta.expectedPx : NaN
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

  constructor(private readonly config: BinanceRestGatewayConfig, clock?: Clock) {
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
      timestamp: this.clock.now().toString()
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
            'content-type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });
        if (!res.ok) {
          const payload = await res.text().catch(() => '');
          const reason = payload || res.statusText;
          if (shouldRetryStatus(res.status)) {
            throw new ExecutionRetryError(`Binance retryable error: ${reason}`, true);
          }
          throw new ExecutionRetryError(reason, false);
        }
        return res;
      });
      const data = await response.json().catch(() => ({}));
      this.orderSymbols.set(order.id, order.symbol.toUpperCase());
    const ts = data.transactTime ?? this.clock.now();
      this.ack(order.id, ts);
      if (data.status === 'FILLED') {
        const px = Number(data.price) || order.px || Number(data.avgPrice) || 0;
        this.fill(order, { px }, ts);
      }
    } catch (error) {
      const reason =
        error instanceof ExecutionRetryError ? error.message : (error as Error)?.message ?? 'Submit failed';
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
      origClientOrderId: orderId
    });
    this.sign(params);
    await withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/api/v3/order?${params.toString()}`, {
        method: 'DELETE',
        headers: {
          'X-MBX-APIKEY': this.config.apiKey
        }
      });
      if (!res.ok) {
        const payload = await res.text().catch(() => '');
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

export interface HyperliquidRestGatewayConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
}

export class HyperliquidRestGateway extends BaseExecutionAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: HyperliquidRestGatewayConfig, clock?: Clock) {
    super(ExecutionVenue.Hyperliquid, clock);
    this.baseUrl = config.baseUrl ?? 'https://api.hyperliquid.xyz';
  }

  private async signedFetch(path: string, body: Record<string, unknown>) {
    const payload = JSON.stringify(body);
    const signature = createHmac('sha256', this.config.apiSecret).update(payload).digest('hex');
    return withRetry(async () => {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
          'x-signature': signature
        },
        body: payload
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const reason = text || res.statusText;
        if (shouldRetryStatus(res.status)) {
          throw new ExecutionRetryError(`Hyperliquid retryable error: ${reason}`, true);
        }
        throw new ExecutionRetryError(reason, false);
      }
      return res;
    });
  }

  async submit(order: OrderNew) {
    try {
      const response = await this.signedFetch('/orders', {
        symbol: order.symbol,
        side: order.side,
        size: order.qty,
        type: order.type === 'LMT' ? 'limit' : 'market',
        price: order.px ?? null,
        tif: order.tif
      });
      const data = await response.json().catch(() => ({}));
      const ts = data.timestamp ?? this.clock.now();
      this.ack(order.id, ts);
      if (data.status === 'filled' || data.filledSize) {
        this.fill(order, { px: data.price ?? order.px }, ts);
      }
    } catch (error) {
      const reason =
        error instanceof ExecutionRetryError ? error.message : (error as Error)?.message ?? 'Submit failed';
      this.reject(order.id, reason);
      throw error;
    }
  }
}
