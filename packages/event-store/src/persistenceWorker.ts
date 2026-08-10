#!/usr/bin/env bun
import { parentPort, workerData } from 'worker_threads';
import type { DomainEvent } from '@rx-trader/core/domain';
import {
  createSharedEventQueueConsumer,
  type SharedQueueHandles,
  type SharedQueueConsumer
} from './sharedEventQueue';
import { loadConfig } from '@rx-trader/config';
import { createEventStore } from './factory';

interface WorkerData {
  queue: SharedQueueHandles;
  env: Record<string, string | undefined>;
}

const data = workerData as WorkerData;
Object.entries(data.env ?? {}).forEach(([key, value]) => {
  if (value !== undefined) {
    process.env[key] = value;
  }
});
const debugPersist = process.env.DEBUG_PERSIST_TEST === '1';
if (debugPersist) {
  console.log('[persist-worker] booted with driver', process.env.EVENT_STORE_DRIVER, process.env.SQLITE_PATH);
}

const queue: SharedQueueConsumer = createSharedEventQueueConsumer(data.queue);

const main = async () => {
  const config = loadConfig();
  const store = await createEventStore(config);
  const committedSubscription = store.stream$.subscribe((event) => {
    parentPort?.postMessage({ type: 'committed', event });
  });

  const loop = async () => {
    for (;;) {
      const batch = queue.dequeueBatch(256, 50);
      if (batch.length === 0) {
        if (queue.isShutdown() && queue.depth() === 0) break;
        continue;
      }
      await store.append(batch as DomainEvent[]);
      if (debugPersist) {
        console.log('[persist-worker] appended batch', batch.length);
      }
    }
  };

  await loop();
  committedSubscription.unsubscribe();
  await store.close?.();
  parentPort?.postMessage({ type: 'shutdown-ack' });
  parentPort?.close();
};

parentPort?.on('message', (msg) => {
  if (msg?.type === 'shutdown') {
    queue.shutdown();
  }
});

void main().catch((error) => {
  console.error('[persist-worker] fatal error', error);
  queue.shutdown();
  process.exitCode = 1;
});
