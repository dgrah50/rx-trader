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

  const loop = async () => {
    for (;;) {
      const batch = queue.dequeueBatch(256, 50);
      if (batch.length === 0) continue;
      try {
        await store.append(batch as DomainEvent[]);
        if (debugPersist) {
          console.log('[persist-worker] appended batch', batch.length);
        }
      } catch (error) {
        console.error('[persist-worker] append failed', error);
      }
    }
  };

  await loop();
};

parentPort?.on('message', (msg) => {
  if (msg?.type === 'shutdown') {
    queue.shutdown();
    parentPort?.postMessage({ type: 'shutdown-ack' });
    process.exit(0);
  }
});

void main();
