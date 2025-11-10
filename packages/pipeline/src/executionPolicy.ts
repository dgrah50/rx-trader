import type { OrderNew } from '@rx-trader/core/domain';
import type { Clock } from '@rx-trader/core/time';
import type { ExecutionAdapter } from '@rx-trader/execution';
import type { Logger } from 'pino';
import type { Metrics } from '@rx-trader/observability/metrics';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

interface ExecutionRetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
}

interface ExecutionCircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
  halfOpenMaxSuccesses: number;
}

interface ExecutionPolicyConfig {
  retry: ExecutionRetryConfig;
  circuitBreaker: ExecutionCircuitBreakerConfig;
}

export class ExecutionCircuitOpenError extends Error {
  constructor(message: string, public readonly retryAt: number) {
    super(message);
    this.name = 'ExecutionCircuitOpenError';
  }
}

type CircuitState = 'closed' | 'half-open' | 'open';

interface ExecutionPolicyOptions {
  adapter: ExecutionAdapter;
  config: ExecutionPolicyConfig;
  metrics?: Metrics;
  logger: Logger;
  clock: Clock;
}

export const createExecutionPolicy = ({
  adapter,
  config,
  metrics,
  logger,
  clock
}: ExecutionPolicyOptions) => {
  let state: CircuitState = 'closed';
  let consecutiveFailures = 0;
  let halfOpenSuccesses = 0;
  let nextAttemptTs = 0;
  const venue = adapter.id;

  const setCircuitGauge = () => {
    const value = state === 'open' ? 1 : state === 'half-open' ? 0.5 : 0;
    metrics?.executionCircuitState.labels({ venue }).set(value);
  };

  setCircuitGauge();

  const openCircuit = (reason: string) => {
    state = 'open';
    halfOpenSuccesses = 0;
    nextAttemptTs = clock.now() + config.circuitBreaker.cooldownMs;
    metrics?.executionCircuitTrips.labels({ venue }).inc();
    metrics?.executionFailures.labels({ venue, reason }).inc();
    setCircuitGauge();
    logger.error({ venue, reason }, 'Execution circuit opened');
  };

  const closeCircuit = () => {
    state = 'closed';
    consecutiveFailures = 0;
    halfOpenSuccesses = 0;
    setCircuitGauge();
    logger.info({ venue }, 'Execution circuit closed');
  };

  const moveToHalfOpenIfReady = () => {
    if (state !== 'open') return;
    if (clock.now() >= nextAttemptTs) {
      state = 'half-open';
      halfOpenSuccesses = 0;
      setCircuitGauge();
      logger.warn({ venue }, 'Execution circuit half-open');
    }
  };

  const calcDelay = (attempt: number) => {
    const base = Math.min(
      config.retry.maxDelayMs,
      config.retry.baseDelayMs * Math.pow(2, attempt - 1)
    );
    const jitterRange = base * config.retry.jitter;
    return Math.max(0, base + (Math.random() * 2 - 1) * jitterRange);
  };

  const submit = async (order: OrderNew) => {
    moveToHalfOpenIfReady();
    if (state === 'open') {
      const error = new ExecutionCircuitOpenError(
        `Execution circuit is open for ${venue}`,
        nextAttemptTs
      );
      logger.error({ venue, orderId: order.id }, error.message);
      throw error;
    }

    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        if (attempt > 1) {
          metrics?.executionRetries.labels({ venue }).inc();
          logger.warn({ venue, orderId: order.id, attempt }, 'Retrying execution submit');
        }
        await adapter.submit(order);
        consecutiveFailures = 0;
        if (state === 'half-open') {
          halfOpenSuccesses += 1;
          if (halfOpenSuccesses >= config.circuitBreaker.halfOpenMaxSuccesses) {
            closeCircuit();
          }
        }
        return;
      } catch (error) {
        const reason = (error as Error)?.message ?? 'submit-error';
        if (state === 'half-open') {
          openCircuit(reason);
          throw error;
        }
        const maxAttempts = config.retry.maxAttempts;
        if (attempt >= maxAttempts) {
          consecutiveFailures += 1;
          logger.error(
            { venue, orderId: order.id, attempt, reason },
            'Execution submit failed'
          );
          if (consecutiveFailures >= config.circuitBreaker.failureThreshold) {
            openCircuit(reason);
          } else {
            metrics?.executionFailures.labels({ venue, reason }).inc();
          }
          throw error;
        }
        const delayMs = calcDelay(attempt);
        await sleep(delayMs);
      }
    }
  };

  return {
    submit
  };
};
