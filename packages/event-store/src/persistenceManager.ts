import { Worker } from 'worker_threads';
import type { DomainEvent } from '@rx-trader/core/domain';
import type { EventStore } from './eventStore';
import { createSharedEventQueue, type SharedQueueProducer } from './sharedEventQueue';
import type { Metrics } from '@rx-trader/observability/metrics';
import type { Logger } from 'pino';

interface PersistenceManagerOptions {
  store: EventStore;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  workerPath: string;
  envSnapshot?: Record<string, string | undefined>;
  queueCapacity?: number;
  slotSize?: number;
  metrics?: Metrics;
  queueHighWatermarkRatio?: number;
  queueSampleIntervalMs?: number;
  workerShutdownTimeoutMs?: number;
}

interface PersistenceManager {
  enqueue: (event: DomainEvent) => void;
  shutdown: () => Promise<void> | void;
}

export const createPersistenceManager = (options: PersistenceManagerOptions): PersistenceManager => {
  const queue: SharedQueueProducer = createSharedEventQueue(
    options.queueCapacity ?? 4096,
    options.slotSize ?? 4096
  );
  const handles = queue.handles();
  const worker = new Worker(options.workerPath, {
    workerData: {
      queue: {
        control: handles.control,
        buffer: handles.buffer,
        capacity: handles.capacity,
        slotSize: handles.slotSize
      },
      env: options.envSnapshot ?? {}
    }
  });

  worker.on('error', (error) => {
    options.logger?.error?.({ error }, 'Persistence worker error');
  });

  let forceTerminateTimer: ReturnType<typeof setTimeout> | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let resolveShutdown: (() => void) | null = null;
  let rejectShutdown: ((error: Error) => void) | null = null;

  worker.on('message', (message: { type?: string; event?: DomainEvent }) => {
    if (message.type === 'committed' && message.event) {
      options.store.stream$.next(message.event);
    } else if (message.type === 'shutdown-ack') {
      resolveShutdown?.();
    }
  });

  worker.on('exit', (code) => {
    if (forceTerminateTimer) {
      clearTimeout(forceTerminateTimer);
      forceTerminateTimer = null;
    }
    if (code !== 0) {
      options.logger?.error?.({ code }, 'Persistence worker exited unexpectedly');
      rejectShutdown?.(new Error(`Persistence worker exited with code ${code}`));
    } else {
      options.logger?.info?.({ code }, 'Persistence worker exited');
      resolveShutdown?.();
    }
  });

  const metrics = options.metrics;
  const highWatermarkRatio = options.queueHighWatermarkRatio ?? 0.8;
  const lowWatermarkRatio = highWatermarkRatio * 0.7;
  let highWatermarkTripped = false;

  const sampleDepth = () => {
    const depth = queue.depth();
    metrics?.persistenceQueueDepth.set(depth);
    const capacity = queue.capacity();
    const ratio = capacity > 0 ? depth / capacity : 0;
    if (!highWatermarkTripped && ratio >= highWatermarkRatio) {
      highWatermarkTripped = true;
      options.logger?.warn?.(
        { depth, capacity },
        'Persistence queue near capacity; falling back to inline writes if needed'
      );
    } else if (highWatermarkTripped && ratio <= lowWatermarkRatio) {
      highWatermarkTripped = false;
    }
  };

  const sampleInterval = metrics
    ? setInterval(sampleDepth, options.queueSampleIntervalMs ?? 1000)
    : undefined;
  if (metrics) {
    sampleDepth();
  }

  const enqueue = (event: DomainEvent) => {
    if (!queue.enqueue(event)) {
      metrics?.persistenceQueueDrops.inc();
      options.logger?.warn?.({ type: event.type }, 'Persistence queue full, writing inline');
      void options.store.append(event).then(
        () => {
          metrics?.persistenceInlineWrites.inc();
        },
        (error) => {
          options.logger?.error?.({ error }, 'Inline event append failed');
        }
      );
    } else {
      // The worker publishes the event only after the database commits it.
    }
    metrics && sampleDepth();
  };

  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = new Promise<void>((resolve, reject) => {
      resolveShutdown = resolve;
      rejectShutdown = reject;
    });
    if (sampleInterval) {
      clearInterval(sampleInterval);
    }
    queue.shutdown();
    try {
      worker.postMessage({ type: 'shutdown' });
    } catch (error) {
      const shutdownError = error instanceof Error ? error : new Error(String(error));
      options.logger?.error?.({ error: shutdownError }, 'Failed to signal persistence worker shutdown');
      rejectShutdown?.(shutdownError);
      return shutdownPromise;
    }
    const timeoutMs = options.workerShutdownTimeoutMs ?? 2_000;
    forceTerminateTimer = setTimeout(() => {
      forceTerminateTimer = null;
      worker
        .terminate()
        .then(() => rejectShutdown?.(new Error('Persistence worker did not flush before shutdown')))
        .catch((error) => {
          options.logger?.error?.({ error }, 'Failed to terminate persistence worker');
          rejectShutdown?.(error instanceof Error ? error : new Error(String(error)));
        });
    }, timeoutMs);
    return shutdownPromise;
  };

  return { enqueue, shutdown };
};
