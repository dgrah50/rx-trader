import { Subject, shareReplay } from 'rxjs';
import WebSocket, { type RawData } from 'ws';
import type { Observable } from 'rxjs';
import type { MarketTick } from '@rx-trader/core';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';

interface FeedLifecycleHooks {
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
  onReconnect?: () => void;
  onTick?: (timestampMs: number) => void;
}

export interface FeedAdapter {
  id?: string;
  feed$: Observable<MarketTick>;
  connect(): void;
  disconnect?(): void;
  setLifecycleHooks?(hooks: FeedLifecycleHooks): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: RawData) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: () => void): this;
}

export interface WebSocketFeedOptions {
  reconnectIntervalMs?: number;
  reconnectMaxIntervalMs?: number;
  reconnectJitter?: number;
  maxReconnectAttempts?: number;
  webSocketFactory?: WebSocketFactory;
  onError?: (error: Error) => void;
  lifecycle?: FeedLifecycleHooks;
  clock?: Clock;
}

const DEFAULT_RECONNECT_MS = 2_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const DEFAULT_RECONNECT_JITTER = 0.3;

export abstract class WebSocketFeed implements FeedAdapter {
  public readonly feed$: Observable<MarketTick>;
  protected socket?: WebSocketLike;

  private readonly subject = new Subject<MarketTick>();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private readonly clock: Clock;
  private lifecycle?: FeedLifecycleHooks;
  private shouldReconnect = true;

  protected constructor(
    public readonly id: string,
    private readonly options: WebSocketFeedOptions = {}
  ) {
    this.feed$ = this.subject.asObservable().pipe(shareReplay({ bufferSize: 1, refCount: true }));
    this.clock = options.clock ?? systemClock;
    this.lifecycle = options.lifecycle;
  }

  setLifecycleHooks(hooks: FeedLifecycleHooks) {
    this.lifecycle = hooks;
  }

  connect() {
    this.shouldReconnect = true;
    if (this.socket || this.isConnecting) {
      return;
    }
    this.openSocket();
  }

  disconnect() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.cleanupSocket(false);
  }

  protected abstract createUrl(): string;
  protected abstract mapMessage(message: unknown): MarketTick | null;

  protected createSubscribePayload(): string | undefined {
    return undefined;
  }

  private openSocket() {
    const url = this.createUrl();
    const socket = this.createSocket(url);
    this.socket = socket;
    this.isConnecting = true;
    this.lifecycle?.onStatusChange?.('connecting');

    socket.on('open', () => {
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.lifecycle?.onStatusChange?.('connected');
      const payload = this.createSubscribePayload();
      if (payload) {
        socket.send(payload);
      }
    });

    socket.on('message', (raw) => this.handleMessage(raw));
    socket.on('error', (error) => {
      this.options.onError?.(error);
      this.scheduleReconnect();
    });
    socket.on('close', () => this.scheduleReconnect());
  }

  private handleMessage(raw: RawData) {
    let parsed: unknown = raw;
    if (Buffer.isBuffer(raw) || raw instanceof ArrayBuffer) {
      parsed = raw.toString();
    }
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return;
      }
    }

    const tick = this.mapMessage(parsed);
    if (tick) {
      this.lifecycle?.onTick?.(tick.t ?? this.clock.now());
      this.subject.next(tick);
    }
  }

  private scheduleReconnect() {
    this.cleanupSocket();
    if (!this.shouldReconnect) {
      return;
    }
    if (this.reconnectTimer) {
      return;
    }
    const maxAttempts = this.options.maxReconnectAttempts;
    if (maxAttempts && this.reconnectAttempts >= maxAttempts) {
      this.options.onError?.(new Error('Max reconnect attempts reached'));
      return;
    }
    const delay = this.computeReconnectDelay();
    this.lifecycle?.onReconnect?.();
    this.lifecycle?.onStatusChange?.('disconnected');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, delay);
    this.reconnectAttempts += 1;
  }

  private computeReconnectDelay() {
    const base = this.options.reconnectIntervalMs ?? DEFAULT_RECONNECT_MS;
    const max = this.options.reconnectMaxIntervalMs ?? DEFAULT_RECONNECT_MAX_MS;
    const jitterRatio = this.options.reconnectJitter ?? DEFAULT_RECONNECT_JITTER;
    const attempt = this.reconnectAttempts;
    const exponential = Math.min(base * Math.pow(2, attempt), max);
    const jitterRange = exponential * jitterRatio;
    const min = Math.max(base, exponential - jitterRange);
    const maxDelay = exponential + jitterRange;
    return Math.random() * (maxDelay - min) + min;
  }

  private cleanupSocket(notify = true) {
    this.isConnecting = false;
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
    if (notify) {
      this.lifecycle?.onStatusChange?.('disconnected');
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private createSocket(url: string): WebSocketLike {
    if (this.options.webSocketFactory) {
      return this.options.webSocketFactory(url);
    }
    return new WebSocket(url);
  }
}
