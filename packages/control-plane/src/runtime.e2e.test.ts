import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Subject, ReplaySubject, filter, firstValueFrom, EMPTY } from 'rxjs';
import type {
  MarketTick,
  OrderNew,
  Fill,
  DomainEvent,
  OrderAck,
  OrderReject,
  PortfolioSnapshot,
  PortfolioAnalytics
} from '@rx-trader/core/domain';
import { FeedType } from '@rx-trader/core/constants';
import { InMemoryEventStore } from '@rx-trader/event-store';
import { createControlPlaneRouter } from '@rx-trader/control-plane/app';
import { loadConfig } from '@rx-trader/config';
import { createMarketStructureStore, MarketStructureRepository } from '@rx-trader/market-structure';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { EngineDependencies } from './startEngine';
import { createManualClock } from '@rx-trader/core/time';
import type { BalanceProvider } from '@rx-trader/portfolio';
import type { InstrumentMetadata } from '@rx-trader/pipeline';
import type { StrategySignal } from '@rx-trader/strategies';

const runE2E = process.env.RUN_E2E_TESTS === 'true';
const debugE2E = process.env.DEBUG_E2E === 'true';
const debugLog = (...args: unknown[]) => {
  if (debugE2E) {
    console.log('[runtime.e2e]', ...args);
  }
};
const maybeDescribe = runE2E ? describe : describe.skip;

const waitForEvent = async <T>(
  source: Parameters<typeof firstValueFrom<T>>[0],
  timeoutMs: number,
  onTimeout?: () => Promise<void> | void
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      firstValueFrom(source),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(async () => {
          if (onTimeout) {
            await onTimeout();
          }
          reject(new Error(`Timed out waiting for event after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};


maybeDescribe('runtime end-to-end integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rx-e2e-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it(
    'streams mocked Binance/Hyperliquid feeds through execution and control plane',
    { timeout: 20_000 },
    async () => {
    const sqlitePath = resolve(tempDir, 'market-structure.sqlite');
    // Use a random high port for the control-plane API to avoid collisions in parallel test runs
    const randomPort = 40000 + Math.floor(Math.random() * 10000);
    const configOverrides = {
      SQLITE_PATH: sqlitePath,
      MARKET_STRUCTURE_SQLITE_PATH: sqlitePath,
      GATEWAY_PORT: String(randomPort),
      STRATEGY_TYPE: 'arbitrage',
      STRATEGY_TRADE_SYMBOL: 'BTCUSDT',
      STRATEGY_PRIMARY_FEED: FeedType.Binance,
      STRATEGY_EXTRA_FEEDS: FeedType.Hyperliquid,
      STRATEGY_PARAMS: JSON.stringify({
        primaryVenue: FeedType.Binance,
        secondaryVenue: FeedType.Hyperliquid,
        spreadBps: 5,
        maxAgeMs: 5000,
        minIntervalMs: 0,
        priceSource: 'bid'
      }),
      ACCOUNT_ID: 'E2E',
      INTENT_MODE: 'makerPreferred',
      INTENT_NOTIONAL_USD: '100',
      INTENT_LIMIT_OFFSET_BPS: '10',
      INTENT_MIN_EDGE_BPS: '5',
      INTENT_TAKER_SLIP_BPS: '2',
      INTENT_ADVERSE_SELECTION_BPS: '5',
      INTENT_POST_ONLY: 'true',
      INTENT_COOLDOWN_MS: '10000',
      INTENT_DEDUPE_WINDOW_MS: '10000',
      INTENT_TIF: 'IOC',
      EVENT_STORE_DRIVER: 'memory',
      RISK_MAX_POSITION: '100',
      RISK_NOTIONAL_LIMIT: '1000000',
      RISK_PRICE_BAND_MIN: '0',
      RISK_PRICE_BAND_MAX: '1000000',
      RISK_THROTTLE_WINDOW_MS: '0',
      RISK_THROTTLE_MAX_COUNT: '100'
    } as const;

    // Seed market structure
    const marketStore = createMarketStructureStore(sqlitePath);
    const repo = new MarketStructureRepository(marketStore.db);
    await repo.ensureExchange({ code: 'binance', name: 'Binance' });
    await repo.ensureExchange({ code: 'hyperliquid', name: 'Hyperliquid' });
    await repo.upsertPair({
      symbol: 'BTCUSDT',
      baseSymbol: 'BTC',
      quoteSymbol: 'USDT',
      assetClass: 'CRYPTO',
      contractType: 'SPOT'
    });
    await repo.upsertExchangePair({
      exchangeCode: 'binance',
      pairSymbol: 'BTCUSDT',
      exchSymbol: 'BTCUSDT',
      tickSize: 0.1,
      lotSize: 0.001,
      minLotSize: 0.001,
      assetClass: 'CRYPTO',
      contractType: 'SPOT'
    });
    await repo.upsertExchangePair({
      exchangeCode: 'hyperliquid',
      pairSymbol: 'BTCUSDT',
      exchSymbol: 'BTCUSDT',
      tickSize: 0.1,
      lotSize: 0.001,
      minLotSize: 0.001,
      assetClass: 'CRYPTO',
      contractType: 'SPOT'
    });
    const feeEffective = Math.floor(Date.now() / 1000) - 60;
    await repo.upsertFeeSchedule({
      exchangeCode: 'binance',
      symbol: 'BTCUSDT',
      productType: 'SPOT',
      makerBps: 8,
      takerBps: 12,
      effectiveFrom: feeEffective,
      source: 'test'
    });
    await repo.upsertFeeSchedule({
      exchangeCode: 'hyperliquid',
      symbol: '*',
      productType: 'SPOT',
      makerBps: 9,
      takerBps: 13,
      effectiveFrom: feeEffective,
      source: 'test'
    });
    marketStore.close();

    const binanceTicks = new ReplaySubject<MarketTick>(1);
    const hyperTicks = new ReplaySubject<MarketTick>(1);

    const feedManagerResult = {
      marks$: binanceTicks.asObservable(),
      sources: [
        {
          id: 'binance-mock',
          stream: binanceTicks.asObservable(),
          adapter: { id: 'binance-mock', feed$: binanceTicks.asObservable(), connect() {}, disconnect() {} }
        },
        {
          id: 'hyperliquid-mock',
          stream: hyperTicks.asObservable(),
          adapter: { id: 'hyperliquid-mock', feed$: hyperTicks.asObservable(), connect() {}, disconnect() {} }
        }
      ],
      stop: () => {
        binanceTicks.complete();
        hyperTicks.complete();
      }
    };
    debugLog('feedManager sources', feedManagerResult.sources.map((s) => s.id));

    const fillsSubject = new Subject<Fill>();
    const strategySignal$ = new Subject<StrategySignal>();
    const eventStore = new InMemoryEventStore();
    const manualClock = createManualClock(10_000);

    const ackSubject = new Subject<OrderAck>();
    const rejectSubject = new Subject<OrderReject>();
    const execEvents = new Subject<DomainEvent>();

    const dependencies: EngineDependencies = {
      createFeedManager: () => feedManagerResult as any,
      createExecutionManager: ({ enqueue }) => {
        const adapterId = 'paper-e2e';
        const adapter = {
          id: adapterId,
          submit: async (order: OrderNew) => {
            const ack: OrderAck = { id: order.id, t: manualClock.now(), venue: adapterId };
            ackSubject.next(ack);
            const ackEvent: DomainEvent = {
              id: randomUUID(),
              type: 'order.ack',
              data: ack,
              ts: ack.t
            };
            execEvents.next(ackEvent);
            enqueue(ackEvent);
          },
          cancel: async () => {}
        };

        return {
          adapter,
          events$: execEvents.asObservable(),
          fills$: fillsSubject.asObservable(),
          acks$: ackSubject.asObservable(),
          rejects$: rejectSubject.asObservable(),
          submit: adapter.submit
        } as any;
      },
      createBalanceProvider: ({ instrument }) => mockBalanceProvider(instrument),
      createEventStore: async () => eventStore,
      createPersistenceManager: () => ({
        enqueue: (event: DomainEvent) => {
          void eventStore.append(event);
        },
        shutdown: () => {}
      }),
      startApiServer: async () => async () => {},
      createStrategy$: () => strategySignal$.asObservable()
    };

    const previousThrottle = process.env.PERSIST_THROTTLE_MS;
    process.env.PERSIST_THROTTLE_MS = '0';
    const { startEngine } = await import('./startEngine');
    debugLog('starting engine');
    const handle = await startEngine({
      live: false,
      registerSignalHandlers: false,
      clock: manualClock,
      configOverrides,
      dependencies
    });
    debugLog('engine started');

    // allow runtime subscriptions to attach before we emit ticks
    await new Promise((resolve) => setTimeout(resolve, 0));
    const initialEvents = await eventStore.read();
    const seedEvent = initialEvents.find(
      (evt) =>
        evt.type === 'account.balance.adjusted' &&
        (evt.data as any)?.metadata?.seed === 'demo'
    );
    expect(seedEvent).toBeDefined();

    const baseTime = 1_000_000;
    const emit = (subject: Subject<MarketTick>, tick: MarketTick) => {
      manualClock.advance(1);
      debugLog('emit tick', tick);
      subject.next(tick);
    };

    const orderEventPromise = waitForEvent(
      eventStore.stream$.pipe(filter((evt) => evt.type === 'order.new')),
      5_000,
      async () => {
        const snapshot = await eventStore.read();
        debugLog('order wait timeout events', snapshot.map((evt) => evt.type));
      }
    );

    emit(binanceTicks, { t: baseTime, symbol: 'BTCUSDT', bid: 100, ask: 100.2, last: 100.1 });
    emit(hyperTicks, { t: baseTime + 5, symbol: 'BTC', bid: 99.7, ask: 99.9, last: 99.8 });
    emit(hyperTicks, { t: baseTime + 10, symbol: 'BTC', bid: 101.6, ask: 101.8, last: 101.7 });
    manualClock.advance(1);
    strategySignal$.next({ symbol: 'BTCUSDT', action: 'BUY', px: 101.7, t: manualClock.now() });
    strategySignal$.complete();
    const order = (await orderEventPromise).data as OrderNew;
    expect(order.meta?.expectedFeeBps).toBe(8);
    expect(order.meta?.feeSource).toBe('test');
    manualClock.advance(1);
    const fillPx = order.px ?? 101.7;
    const fillQty = order.qty ?? 1;
    const feeBps = order.meta?.expectedFeeBps ?? 0;
    const feeAmount = Math.abs((fillPx * fillQty * feeBps) / 10_000);
    const fill: Fill = {
      id: randomUUID(),
      orderId: order.id,
      t: manualClock.now(),
      symbol: order.symbol,
      px: fillPx,
      qty: fillQty,
      side: order.side,
      fee: feeAmount
    };
    fillsSubject.next(fill);
    await eventStore.append({
      id: fill.id,
      type: 'order.fill',
      data: fill,
      ts: fill.t
    });
    emit(binanceTicks, { t: baseTime + 25, symbol: 'BTCUSDT', bid: 101.7, ask: 101.9, last: 101.8 });
    binanceTicks.complete();
    hyperTicks.complete();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const events = await eventStore.read();
    const snapshotEvent = events.find((evt) => evt.type === 'portfolio.snapshot');
    expect(snapshotEvent).toBeDefined();
    const snapshot = snapshotEvent?.data as PortfolioSnapshot;
    expect(snapshot.feesPaid).toBeGreaterThan(0);
    const pnlEvent = events.find((evt) => evt.type === 'pnl.analytics');
    expect(pnlEvent).toBeDefined();
    const pnl = pnlEvent?.data as PortfolioAnalytics;
    expect(pnl.feesPaid).toBe(snapshot.feesPaid);

    const router = await createControlPlaneRouter(loadConfig(configOverrides), { store: eventStore });
    const positionsRes = await router(new Request('http://local/positions'));
    expect(positionsRes.status).toBe(200);
    const posJson = await positionsRes.json();
    expect(posJson.BTCUSDT).toBeDefined();

    const pnlRes = await router(new Request('http://local/pnl'));
    expect(pnlRes.status).toBe(200);
    const pnlJson = await pnlRes.json();
    expect(pnlJson?.nav).toBeDefined();
    expect(pnlJson?.feesPaid).toBeCloseTo(feeAmount, 10);

    handle.stop();
    process.env.PERSIST_THROTTLE_MS = previousThrottle;
    binanceTicks.complete();
    hyperTicks.complete();
  }
  );

  it(
    'emits exit intents when time-stop config triggers',
    { timeout: 20_000 },
    async () => {
      const sqlitePath = resolve(tempDir, 'market-structure.sqlite');
      const randomPort = 42000 + Math.floor(Math.random() * 10000);
      const strategiesOverride = JSON.stringify([
        {
          id: 'exit-demo',
          type: 'MOMENTUM',
          tradeSymbol: 'BTCUSDT',
          primaryFeed: 'BINANCE',
          params: {},
          exit: {
            enabled: true,
            time: { enabled: true, maxHoldMs: 500 }
          }
        }
      ]);
      const configOverrides = {
        SQLITE_PATH: sqlitePath,
        MARKET_STRUCTURE_SQLITE_PATH: sqlitePath,
        GATEWAY_PORT: String(randomPort),
        STRATEGIES: strategiesOverride,
        ACCOUNT_ID: 'E2E-EXIT',
        INTENT_MODE: 'market',
        INTENT_NOTIONAL_USD: '100',
        INTENT_TIF: 'IOC',
        EVENT_STORE_DRIVER: 'memory',
        RISK_MAX_POSITION: '10',
        RISK_NOTIONAL_LIMIT: '1000000',
        RISK_PRICE_BAND_MIN: '0',
        RISK_PRICE_BAND_MAX: '1000000',
        RISK_THROTTLE_WINDOW_MS: '0',
        RISK_THROTTLE_MAX_COUNT: '100'
      } as const;

      const previewConfig = loadConfig(configOverrides);
      if (debugE2E) {
        console.log('[runtime.e2e] preview strategies', previewConfig.strategies.map((s) => s.id));
      }
      expect(previewConfig.strategies[0]?.exit?.time?.enabled).toBe(true);

      const marketStore = createMarketStructureStore(sqlitePath);
      const repo = new MarketStructureRepository(marketStore.db);
      await repo.ensureExchange({ code: 'binance', name: 'Binance' });
      await repo.upsertPair({
        symbol: 'BTCUSDT',
        baseSymbol: 'BTC',
        quoteSymbol: 'USDT',
        assetClass: 'CRYPTO',
        contractType: 'SPOT'
      });
      await repo.upsertExchangePair({
        exchangeCode: 'binance',
        pairSymbol: 'BTCUSDT',
        exchSymbol: 'BTCUSDT',
        tickSize: 0.1,
        lotSize: 0.001,
        minLotSize: 0.001,
        assetClass: 'CRYPTO',
        contractType: 'SPOT'
      });
      await repo.upsertFeeSchedule({
        exchangeCode: 'binance',
        symbol: 'BTCUSDT',
        productType: 'SPOT',
        makerBps: 7,
        takerBps: 11,
        effectiveFrom: Math.floor(Date.now() / 1000) - 60,
        source: 'test'
      });
      marketStore.close();

      const marks$ = new ReplaySubject<MarketTick>(1);
      const feedManagerResult = {
        marks$: marks$.asObservable(),
        sources: [
          {
            id: 'binance-mock',
            stream: marks$.asObservable(),
            adapter: { id: 'binance-mock', feed$: marks$.asObservable(), connect() {}, disconnect() {} }
          }
        ],
        stop: () => marks$.complete()
      };

      const fillsSubject = new Subject<Fill>();
      const eventStore = new InMemoryEventStore();
      const manualClock = createManualClock(0);
      const ackSubject = new Subject<OrderAck>();
      const rejectSubject = new Subject<OrderReject>();
      const execEvents = new Subject<DomainEvent>();
      const exitIntentSubject = new Subject<OrderNew>();
      const snapshotLog: PortfolioSnapshot[] = [];

      const dependencies: EngineDependencies = {
        createFeedManager: () => feedManagerResult as any,
        createStrategy$: () => EMPTY,
        createExecutionManager: ({ enqueue }) => {
          const adapterId = 'paper-exit';
          const adapter = {
            id: adapterId,
            submit: async (order: OrderNew) => {
              const ack: OrderAck = { id: order.id, t: manualClock.now(), venue: adapterId };
              ackSubject.next(ack);
              const ackEvent: DomainEvent = {
                id: randomUUID(),
                type: 'order.ack',
                data: ack,
                ts: ack.t
              };
              execEvents.next(ackEvent);
              enqueue(ackEvent);
            },
            cancel: async () => {}
          };
          return {
            adapter,
            events$: execEvents.asObservable(),
            fills$: fillsSubject.asObservable(),
            acks$: ackSubject.asObservable(),
            rejects$: rejectSubject.asObservable(),
            submit: adapter.submit
          } as any;
        },
        createBalanceProvider: ({ instrument }) => mockBalanceProvider(instrument),
        createEventStore: async () => eventStore,
        createPersistenceManager: () => ({
          enqueue: (event: DomainEvent) => {
            void eventStore.append(event);
          },
          shutdown: () => {}
        }),
        startApiServer: async () => async () => {}
      };

      const previousThrottle = process.env.PERSIST_THROTTLE_MS;
      process.env.PERSIST_THROTTLE_MS = '0';
      const { startEngine } = await import('./startEngine');
      const handle = await startEngine({
        live: false,
        registerSignalHandlers: false,
        clock: manualClock,
        configOverrides,
        dependencies,
        hooks: {
          onExitIntent: (order) => exitIntentSubject.next(order)
          ,
          onSnapshot: (snapshot) => {
            snapshotLog.push(snapshot);
            if (debugE2E) {
              console.log('[runtime.e2e] snapshot', snapshot.positions['BTCUSDT']);
            }
          }
        }
      });

      const emitMark = (tick: Omit<MarketTick, 't'>) => {
        manualClock.advance(1);
        marks$.next({ ...tick, t: manualClock.now() });
      };

      await new Promise((resolve) => setTimeout(resolve, 0));
      const orderEvents$ = eventStore.stream$.pipe(filter(isOrderNewEvent));

      emitMark({ symbol: 'BTCUSDT', bid: 100, ask: 100.1, last: 100.05 });
      const syntheticOrderId = randomUUID();
      const fill: Fill = {
        id: randomUUID(),
        orderId: syntheticOrderId,
        t: manualClock.now(),
        symbol: 'BTCUSDT',
        px: 100.1,
        qty: 0.5,
        side: 'BUY'
      };
      fillsSubject.next(fill);
      await eventStore.append({
        id: fill.id,
        type: 'order.fill',
        data: fill,
        ts: fill.t
      });

      const analyticsEvent = await waitForEvent(
        eventStore.stream$.pipe(filter((evt) => evt.type === 'pnl.analytics')),
        2_000
      );
      debugLog('analytics event', analyticsEvent.data);

      const exitIntentPromise = firstValueFrom(exitIntentSubject);
      const exitOrderEventPromise = waitForEvent(
        orderEvents$.pipe(filter(isExitOrderEvent)),
        5_000,
        async () => {
          const snapshot = await eventStore.read();
          const summary = snapshot.map((evt) => ({
            type: evt.type,
            meta: (evt.data as any)?.meta
          }));
          debugLog('exit wait timeout events', summary);
          if (debugE2E) {
            console.log('[runtime.e2e] exit wait timeout events', summary);
          }
        }
      );

      manualClock.advance(600);
      emitMark({ symbol: 'BTCUSDT', bid: 100.4, ask: 100.5, last: 100.45 });

      debugLog('waiting for exit intent hook');
      const exitOrderFromHook = await exitIntentPromise;
      debugLog('exit intent hook received', exitOrderFromHook.id);
      const exitOrderEvent = await exitOrderEventPromise;
      const exitOrder = exitOrderEvent.data as OrderNew;
      expect(exitOrderFromHook.meta?.exit).toBe(true);
      expect(exitOrder.meta?.exit).toBe(true);
      expect(exitOrder.meta?.reason).toBe('EXIT_TIME');
      expect(exitOrder.side).toBe('SELL');

      handle.stop();
      process.env.PERSIST_THROTTLE_MS = previousThrottle;
      marks$.complete();
      exitIntentSubject.complete();
    }
  );
});

const mockBalanceProvider = (instrument: InstrumentMetadata): BalanceProvider => {
  const base = instrument.baseAsset ?? 'BTC';
  const quote = instrument.quoteAsset ?? 'USDT';
  const venue = instrument.venue ?? 'paper';
  return {
    venue,
    async sync() {
      return [
        { venue, asset: base, available: 0.25, locked: 0 },
        { venue, asset: quote, available: 20_000, locked: 0 }
      ];
    },
    stop() {}
  } satisfies BalanceProvider;
};
const isOrderNewEvent = (event: DomainEvent): event is DomainEvent<'order.new'> => event.type === 'order.new';
const isExitOrderEvent = (event: DomainEvent<'order.new'>): boolean =>
  Boolean((event.data as OrderNew).meta?.exit);
