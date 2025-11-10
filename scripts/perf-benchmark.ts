#!/usr/bin/env bun
import { simpleMomentumStrategy, createIntentBuilder, benchmarkPulseStrategy } from '@rx-trader/strategies';
import { InMemoryEventStore } from '@rx-trader/event-store';
import type { OrderNew } from '@rx-trader/core/domain';
import { splitRiskStream } from '@rx-trader/risk/preTrade';
import { BinanceFeedAdapter } from '@rx-trader/feeds';
import { startMockFeedServer, type TickPayload } from './mock-feed-server';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tap } from 'rxjs';
import type { Clock } from '@rx-trader/core/time';
import { createScriptClock } from './lib/scriptClock';

interface BenchmarkOptions {
  ticks: number;
  symbol: string;
  warmup: number;
  feedPort: number;
  paceMicros: number;
  persistence: 'memory' | 'none';
  fastWindow: number;
  slowWindow: number;
  strategy: 'momentum' | 'pulse';
  minDeltaBps: number;
  tickFile?: string;
}

interface Stats {
  min: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const parseArgs = (): BenchmarkOptions => {
  const env = process.env;
  const defaults: BenchmarkOptions = {
    ticks: Number(env.BENCH_TICKS ?? 50_000),
    symbol: (env.BENCH_SYMBOL ?? 'BTCUSDT').toUpperCase(),
    warmup: Number(env.BENCH_WARMUP ?? 1_000),
    feedPort: Number(env.BENCH_FEED_PORT ?? 9001),
    paceMicros: Number(env.BENCH_PACE ?? 0),
    persistence: (env.BENCH_STORE as 'memory' | 'none') ?? 'memory',
    fastWindow: Number(env.BENCH_FAST ?? 3),
    slowWindow: Number(env.BENCH_SLOW ?? 5),
    strategy: (env.BENCH_STRATEGY as 'momentum' | 'pulse') ?? 'pulse',
    minDeltaBps: Number(env.BENCH_MIN_DELTA_BPS ?? 0)
  };

  const tokens = process.argv.slice(2);
  const args: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!;
    if (!raw.startsWith('--')) continue;
    const trimmed = raw.slice(2);
    if (!trimmed) continue;
    if (trimmed.includes('=')) {
      const [k, v] = trimmed.split('=');
      args[k] = v ?? 'true';
      continue;
    }
    const next = tokens[i + 1];
    if (next && !next.startsWith('--')) {
      args[trimmed] = next;
      i += 1;
    } else {
      args[trimmed] = 'true';
    }
  }

  const persistenceInput = (args.store ?? defaults.persistence) as string;
  if (!['memory', 'none'].includes(persistenceInput)) {
    throw new Error('Benchmark --store must be "memory" or "none".');
  }
  const persistence = persistenceInput as 'memory' | 'none';
  return {
    ticks: Number(args.ticks ?? defaults.ticks),
    symbol: (args.symbol ?? defaults.symbol).toUpperCase(),
    warmup: Number(args.warmup ?? defaults.warmup),
    feedPort: Number(args['feed-port'] ?? defaults.feedPort),
    paceMicros: Number(args.pace ?? defaults.paceMicros),
    persistence,
    fastWindow: Number(args.fast ?? defaults.fastWindow),
    slowWindow: Number(args.slow ?? defaults.slowWindow),
    strategy: (args.strategy as 'momentum' | 'pulse') ?? defaults.strategy,
    minDeltaBps: Number(args['min-delta-bps'] ?? defaults.minDeltaBps),
    tickFile: args.file
  };
};

const createWirePayload = (clock: Clock, symbol: string, idx: number) => {
  const segment = 64;
  const cycle = Math.floor(idx / segment);
  const position = idx % segment;
  const direction = cycle % 2 === 0 ? 1 : -1;
  const base = 100 + cycle * 0.05;
  const price = base + direction * position * 0.08;
  return JSON.stringify({
    E: clock.now() + idx,
    s: symbol.toUpperCase(),
    b: (price - 0.05).toFixed(2),
    B: '1.0',
    a: (price + 0.05).toFixed(2),
    A: '1.0',
    c: price.toFixed(2)
  });
};

const loadOrGeneratePayloads = (clock: Clock, options: BenchmarkOptions): TickPayload[] => {
  if (options.tickFile && existsSync(options.tickFile)) {
    const lines = readFileSync(options.tickFile, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => ({ raw: line.trim() }));
    if (lines.length) {
      return lines;
    }
  }
  const payloads = new Array(options.ticks)
    .fill(null)
    .map((_, idx) => ({ raw: createWirePayload(clock, options.symbol, idx) }));
  if (options.tickFile) {
    writeFileSync(options.tickFile, payloads.map((p) => p.raw).join('\n'));
  }
  return payloads;
};

const computeStats = (values: number[]): Stats | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const percentile = (p: number) => {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  };
  return {
    min: sorted[0],
    avg: sum / values.length,
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    max: sorted[sorted.length - 1]
  };
};

const formatStatsTable = (stats: Stats) => ({
  min: stats.min.toFixed(2),
  avg: stats.avg.toFixed(2),
  p50: stats.p50.toFixed(2),
  p95: stats.p95.toFixed(2),
  p99: stats.p99.toFixed(2),
  max: stats.max.toFixed(2)
});

type StageName = 'parse' | 'pipeline' | 'intent' | 'persistence';

interface StageAccumulator {
  totalNs: bigint;
  count: number;
}

const createStageTotals = (): Record<StageName, StageAccumulator> => ({
  parse: { totalNs: 0n, count: 0 },
  pipeline: { totalNs: 0n, count: 0 },
  intent: { totalNs: 0n, count: 0 },
  persistence: { totalNs: 0n, count: 0 }
});

const recordStage = (
  totals: Record<StageName, StageAccumulator>,
  stage: StageName,
  durationNs: bigint
) => {
  const entry = totals[stage];
  entry.totalNs += durationNs;
  entry.count += 1;
};

class FastQueue<T> {
  private buffer: T[] = [];
  private head = 0;

  push(value: T) {
    this.buffer.push(value);
  }

  shift(): T | undefined {
    if (this.head >= this.buffer.length) {
      return undefined;
    }
    const value = this.buffer[this.head];
    this.head += 1;
    if (this.head > 50_000 && this.head * 2 > this.buffer.length) {
      this.buffer = this.buffer.slice(this.head);
      this.head = 0;
    }
    return value;
  }
}

const formatStageTable = (totals: Record<StageName, StageAccumulator>) => {
  const order: StageName[] = ['parse', 'pipeline', 'intent', 'persistence'];
  return order.map((stage) => {
    const entry = totals[stage];
    const totalMs = Number(entry.totalNs) / 1_000_000;
    const avgUs =
      entry.count > 0 ? Number(entry.totalNs) / entry.count / 1_000 : 0;
    return {
      stage,
      totalMs: totalMs.toFixed(2),
      avgUs: avgUs.toFixed(2)
    };
  });
};

const main = async () => {
  const options = parseArgs();
  const { clock: benchClock, meta: benchClockMeta } = createScriptClock('bench');
  console.log(
    `[bench] Clock source=${benchClockMeta.source} start=${new Date(benchClockMeta.startMs).toISOString()} env=${benchClockMeta.env ?? 'system'}`
  );
  const payloads = loadOrGeneratePayloads(benchClock, options);
  const stageTotals = createStageTotals();
  const sendTimes = new FastQueue<bigint>();
  const feedStartTimes = new FastQueue<bigint>();
  const latencyStartTimes = new FastQueue<bigint>();
  const signalTimes = new FastQueue<bigint>();

  const settleFeed = () => {
    if (!feedFinished) {
      feedFinished = true;
      resolveFeed();
      maybeResolveAll();
      console.log('[bench] Feed stream completed');
    }
  };

  const server = startMockFeedServer({
    port: options.feedPort,
    payloads,
    paceMicros: options.paceMicros,
    loop: false,
    batchSize: 1_000,
    onSend: ({ timestamp }) => sendTimes.push(timestamp),
    onComplete: settleFeed
  });
  console.log(
    `[bench] Mock feed listening on ws://localhost:${server.port} (ticks=${payloads.length.toLocaleString()}, pace=${options.paceMicros}µs, batch=1000)`
  );

  const adapter = new BinanceFeedAdapter({
    symbol: options.symbol,
    baseUrl: `ws://localhost:${server.port}`,
    reconnectIntervalMs: 5_000,
    maxReconnectAttempts: 1
  });
  adapter.connect();
  console.log('[bench] Binance adapter connecting to mock feed…');
  console.log(
    `[bench] Strategy=${options.strategy}${
      options.strategy === 'momentum'
        ? ` (fast=${options.fastWindow}, slow=${options.slowWindow})`
        : ` (minDeltaBps=${options.minDeltaBps})`
    }`
  );

  const feed$ = adapter.feed$;
  const latencies: number[] = [];
  const execLatencies: number[] = [];
  const persistenceLatencies: number[] = [];
  let signalsObserved = 0;
  let intentsEmitted = 0;
  let tradesPersisted = 0;
  let decisionsProcessed = 0;
  let pendingPersistence = 0;
  let feedFinished = false;
  const benchStart = process.hrtime.bigint();
  let resolveAll!: () => void;
  let resolved = false;
  let maybeResolveAll: () => void = () => {};
  const allDone = new Promise<void>((resolve) => {
    resolveAll = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    maybeResolveAll = () => {
      if (feedFinished && pendingPersistence === 0 && decisionsProcessed >= intentsEmitted) {
        console.log(
          '[bench] Pipeline drain complete',
          `(intents=${intentsEmitted}, processed=${decisionsProcessed})`
        );
        resolveAll();
      } else if (feedFinished) {
        console.log(
          '[bench] Waiting on pipeline drain',
          `(intents=${intentsEmitted}, processed=${decisionsProcessed}, pending=${pendingPersistence})`
        );
      }
    };
  });

  let resolveFeed!: () => void;
  const feedConsumed = new Promise<void>((resolve) => {
    resolveFeed = resolve;
  });

  let ticksSeen = 0;
  const targetTicks = payloads.length;

  const maybeResolveFeed = () => {
    if (!feedFinished && ticksSeen >= targetTicks) {
      settleFeed();
    }
  };

  feed$.subscribe({
    next: () => {
      const now = process.hrtime.bigint();
      const sent = sendTimes.shift();
      if (sent) {
        recordStage(stageTotals, 'parse', now - sent);
      }
      feedStartTimes.push(now);
      ticksSeen += 1;
      maybeResolveFeed();
    },
    error: (err) => {
      console.error('[bench] Feed stream error', err);
      settleFeed();
    }
  });

  const baseStrategy$ =
    options.strategy === 'momentum'
      ? simpleMomentumStrategy(feed$, {
          symbol: options.symbol,
          fastWindow: options.fastWindow,
          slowWindow: options.slowWindow
        })
      : benchmarkPulseStrategy(feed$, {
          symbol: options.symbol,
          minDeltaBps: options.minDeltaBps
        });

  const strategy$ = baseStrategy$.pipe(
    tap(() => {
      const start = feedStartTimes.shift();
      if (!start) {
        return;
      }
      const now = process.hrtime.bigint();
      recordStage(stageTotals, 'pipeline', now - start);
      latencyStartTimes.push(start);
      signalTimes.push(now);
      signalsObserved += 1;
    })
  );

  const buildIntents = createIntentBuilder({
    account: 'BENCH',
    policy: {
      mode: 'makerPreferred',
      minEdgeBps: 0,
      limitOffsetBps: 0,
      makerFeeBps: 0,
      takerFeeBps: 0,
      takerSlipBps: 0,
      adverseSelectionBps: 0,
      defaultQty: 1,
      postOnly: false,
      reduceOnly: false,
      tif: 'DAY',
      cooldownMs: 0,
      dedupeWindowMs: 0
    }
  });

  const intents$ = buildIntents(strategy$, feed$).pipe(
    tap(() => {
      intentsEmitted += 1;
    })
  );
  const riskConfig = {
    notional: 1_000_000_000,
    maxPosition: 100_000,
    priceBands: {
      [options.symbol]: { min: 0, max: Number.MAX_SAFE_INTEGER }
    },
    throttle: { windowMs: 1, maxCount: 1_000_000 }
  };
  const [approved$, rejected$] = splitRiskStream(intents$, riskConfig);

  const store = options.persistence === 'memory' ? new InMemoryEventStore() : null;

  const measureIntentStage = () => {
    const signalTime = signalTimes.shift();
    const now = process.hrtime.bigint();
    if (signalTime) {
      recordStage(stageTotals, 'intent', now - signalTime);
    }
    const latencyStart = latencyStartTimes.shift();
    return { now, latencyStart };
  };

  rejected$.subscribe(() => {
    measureIntentStage();
    decisionsProcessed += 1;
    maybeResolveAll();
  });

  approved$.subscribe((decision) => {
    const { now, latencyStart } = measureIntentStage();
    if (latencyStart) {
      latencies.push(Number(now - latencyStart) / 1_000);
    }

    const execStart = process.hrtime.bigint();
    const order: OrderNew = decision.order;
    execLatencies.push(Number(process.hrtime.bigint() - execStart) / 1_000);

    const persistEvents = async () => {
      if (!store) {
        return;
      }
      pendingPersistence += 1;
      const persistenceStart = process.hrtime.bigint();
      try {
        const events = [
          { id: crypto.randomUUID(), type: 'order.new' as const, data: order, ts: order.t },
          {
            id: crypto.randomUUID(),
            type: 'order.fill' as const,
            data: {
              id: crypto.randomUUID(),
              orderId: order.id,
              t: order.t,
              symbol: order.symbol,
              px: order.px,
              qty: order.qty,
              side: order.side
            },
            ts: order.t
          }
        ];
        await store.append(events);
        tradesPersisted += 1;
        const elapsed = process.hrtime.bigint() - persistenceStart;
        recordStage(stageTotals, 'persistence', elapsed);
        persistenceLatencies.push(Number(elapsed) / 1_000);
      } finally {
        pendingPersistence -= 1;
        maybeResolveAll();
      }
    };

    void persistEvents();
    decisionsProcessed += 1;
    maybeResolveAll();
  });

  await feedConsumed;
  console.log('[bench] All ticks consumed, waiting for pipeline to drain…');
  adapter.disconnect();
  server.stop();
  await allDone;
  console.log('[bench] Pipeline drained; computing stats…');

  const elapsedMs = Number(process.hrtime.bigint() - benchStart) / 1_000_000;
  const throughput = elapsedMs > 0 ? signalsObserved / (elapsedMs / 1_000) : 0;
  const warmupTrim = Math.min(options.warmup, latencies.length);
  const latencyStats = computeStats(latencies.slice(warmupTrim));
  const execStats = computeStats(execLatencies);
  const persistenceStats = computeStats(persistenceLatencies);

  console.log('--- Pipeline Summary ---');
  console.log('Ticks replayed:       ', payloads.length.toLocaleString());
  console.log('Signals observed:     ', signalsObserved.toLocaleString());
  console.log('Decisions processed:  ', decisionsProcessed.toLocaleString());
  console.log('Trades persisted:     ', tradesPersisted.toLocaleString());
  console.log(`Elapsed time:         ${elapsedMs.toFixed(2)} ms`);
  console.log(`Throughput:           ${throughput.toFixed(2)} signals/sec`);

  console.log('\nStage Timing Summary (total ms / avg µs):');
  console.table(formatStageTable(stageTotals));

  if (latencyStats) {
    console.log('\nLatency (tick → approved intent) µs:');
    console.table(formatStatsTable(latencyStats));
  } else {
    console.log('\nNo approved intents observed (no latency sample).');
  }

  if (execStats) {
    console.log('\nExecution serialization latency (intent → submit) µs:');
    console.table(formatStatsTable(execStats));
  }

  if (persistenceStats && persistenceLatencies.length) {
    console.log('\nPersistence latency (intent → event-store append) µs:');
    console.table(formatStatsTable(persistenceStats));
  }

  console.log('[bench] Benchmark complete.');
};

void main();
