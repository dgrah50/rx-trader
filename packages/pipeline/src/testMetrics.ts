import { Registry } from 'prom-client';
import type { Counter, Gauge, Histogram } from 'prom-client';
import type { Metrics } from '@rx-trader/observability/metrics';

type Labels = Record<string, string> | undefined;

const keyFor = (labels?: Record<string, string>) => JSON.stringify(labels ?? {});

interface MetricState {
  counters: Record<string, Map<string, number>>;
  gauges: Record<string, Map<string, number>>;
  histograms: Record<string, Map<string, number[]>>;
}

const applyCounter = (
  name: string,
  state: MetricState,
  labels: Labels,
  delta: number
) => {
  const bucket = state.counters[name] ?? (state.counters[name] = new Map());
  const key = keyFor(labels);
  bucket.set(key, (bucket.get(key) ?? 0) + delta);
};

const applyGauge = (
  name: string,
  state: MetricState,
  labels: Labels,
  next: (current: number | undefined) => number
) => {
  const bucket = state.gauges[name] ?? (state.gauges[name] = new Map());
  const key = keyFor(labels);
  const current = bucket.get(key);
  bucket.set(key, next(current));
};

const recordHistogram = (
  name: string,
  state: MetricState,
  labels: Labels,
  value: number
) => {
  const bucket = state.histograms[name] ?? (state.histograms[name] = new Map());
  const key = keyFor(labels);
  const existing = bucket.get(key) ?? [];
  existing.push(value);
  bucket.set(key, existing);
};

const createCounterStub = (name: string, state: MetricState): Counter => {
  const counter = {
    inc(arg1?: number | Record<string, string>, arg2?: number) {
      if (typeof arg1 === 'number' || typeof arg1 === 'undefined') {
        const value = typeof arg1 === 'number' ? arg1 : 1;
        applyCounter(name, state, undefined, value);
        return;
      }
      const labels = arg1;
      const value = typeof arg2 === 'number' ? arg2 : 1;
      applyCounter(name, state, labels, value);
    },
    labels(labels: Record<string, string>) {
      return {
        inc: (value?: number) => counter.inc(labels, value)
      } as Counter;
    },
    reset() {
      state.counters[name] = new Map();
    }
  };
  return counter as unknown as Counter;
};

const createGaugeStub = (name: string, state: MetricState): Gauge => {
  const gauge = {
    set(arg1?: number | Record<string, string>, arg2?: number) {
      if (typeof arg1 === 'number' || typeof arg1 === 'undefined') {
        const value = typeof arg1 === 'number' ? arg1 : 0;
        applyGauge(name, state, undefined, () => value);
        return;
      }
      const labels = arg1;
      const value = typeof arg2 === 'number' ? arg2 : 0;
      applyGauge(name, state, labels, () => value);
    },
    inc(arg1?: number | Record<string, string>, arg2?: number) {
      if (typeof arg1 === 'number' || typeof arg1 === 'undefined') {
        const value = typeof arg1 === 'number' ? arg1 : 1;
        applyGauge(name, state, undefined, (current) => (current ?? 0) + value);
        return;
      }
      const labels = arg1;
      const value = typeof arg2 === 'number' ? arg2 : 1;
      applyGauge(name, state, labels, (current) => (current ?? 0) + value);
    },
    dec(arg1?: number | Record<string, string>, arg2?: number) {
      if (typeof arg1 === 'number' || typeof arg1 === 'undefined') {
        const value = typeof arg1 === 'number' ? arg1 : 1;
        applyGauge(name, state, undefined, (current) => (current ?? 0) - value);
        return;
      }
      const labels = arg1;
      const value = typeof arg2 === 'number' ? arg2 : 1;
      applyGauge(name, state, labels, (current) => (current ?? 0) - value);
    },
    labels(labels: Record<string, string>) {
      return {
        set: (value?: number) => gauge.set(labels, value),
        inc: (value?: number) => gauge.inc(labels, value),
        dec: (value?: number) => gauge.dec(labels, value)
      } as Gauge;
    },
    reset() {
      state.gauges[name] = new Map();
    },
    setToCurrentTime() {
      applyGauge(name, state, undefined, () => Date.now());
    }
  };
  return gauge as unknown as Gauge;
};

const createHistogramStub = (name: string, state: MetricState): Histogram => {
  const histogram = {
    observe(arg1?: number | Record<string, string>, arg2?: number) {
      if (typeof arg1 === 'number' || typeof arg1 === 'undefined') {
        const value = typeof arg1 === 'number' ? arg1 : 0;
        recordHistogram(name, state, undefined, value);
        return;
      }
      const labels = arg1;
      const value = typeof arg2 === 'number' ? arg2 : 0;
      recordHistogram(name, state, labels, value);
    },
    startTimer(labels?: Record<string, string>) {
      const start = process.hrtime.bigint();
      return (value?: number) => {
        const durationSeconds =
          value ??
          Number(process.hrtime.bigint() - start) / 1_000_000_000;
        histogram.observe(labels, durationSeconds);
      };
    },
    labels(labels: Record<string, string>) {
      return {
        observe: (value?: number) => histogram.observe(labels, value),
        startTimer: () => histogram.startTimer(labels)
      } as Histogram;
    }
  };
  return histogram as unknown as Histogram;
};

interface TestMetrics extends Metrics {
  __state: MetricState;
}

export const createTestMetrics = (): TestMetrics => {
  const state: MetricState = { counters: {}, gauges: {}, histograms: {} };
  const register = new Registry();
  return {
    register,
    ticksIngested: createCounterStub('ticksIngested', state),
    ordersSubmitted: createCounterStub('ordersSubmitted', state),
    riskRejected: createCounterStub('riskRejected', state),
    portfolioNav: createGaugeStub('portfolioNav', state),
    feedReconnects: createCounterStub('feedReconnects', state),
    feedStatus: createGaugeStub('feedStatus', state),
    feedTickAge: createGaugeStub('feedTickAge', state),
    persistenceQueueDepth: createGaugeStub('persistenceQueueDepth', state),
    persistenceQueueDrops: createCounterStub('persistenceQueueDrops', state),
    persistenceInlineWrites: createCounterStub('persistenceInlineWrites', state),
    executionRetries: createCounterStub('executionRetries', state),
    executionFailures: createCounterStub('executionFailures', state),
    executionCircuitState: createGaugeStub('executionCircuitState', state),
    executionCircuitTrips: createCounterStub('executionCircuitTrips', state),
    executionPendingIntents: createGaugeStub('executionPendingIntents', state),
    executionStaleIntents: createCounterStub('executionStaleIntents', state),
    eventStoreAppendDuration: createHistogramStub('eventStoreAppendDuration', state),
    eventStoreReadDuration: createHistogramStub('eventStoreReadDuration', state),
    // Balance sync + rebalancer/accounting metrics used by runtime services
    balanceSyncFailures: createCounterStub('balanceSyncFailures', state),
    balanceSyncStatus: createGaugeStub('balanceSyncStatus', state),
    balanceSyncLastSuccess: createGaugeStub('balanceSyncLastSuccess', state),
    balanceSyncDriftBps: createGaugeStub('balanceSyncDriftBps', state),
    accountTransfersRequested: createCounterStub('accountTransfersRequested', state),
    accountTransfersExecuted: createCounterStub('accountTransfersExecuted', state),
    accountTransfersFailed: createCounterStub('accountTransfersFailed', state),
    __state: state
  } satisfies TestMetrics;
};

export const getCounterValue = (
  metrics: TestMetrics,
  name: string,
  labels?: Record<string, string>
) => metrics.__state.counters[name]?.get(keyFor(labels)) ?? 0;

export const getGaugeValue = (
  metrics: TestMetrics,
  name: string,
  labels?: Record<string, string>
) => metrics.__state.gauges[name]?.get(keyFor(labels)) ?? 0;
