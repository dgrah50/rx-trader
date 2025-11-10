import { Pool } from 'pg';
import type { AppConfig } from '@rx-trader/config';
import { InMemoryEventStore } from './eventStore';
import { PostgresEventStore } from './postgresEventStore';
import { SqliteEventStore } from './sqliteEventStore';
import { instrumentEventStore } from './instrumentedEventStore';
import type { Metrics } from '@rx-trader/observability/metrics';

export const createEventStore = async (config: AppConfig, metrics?: Metrics) => {
  if (config.persistence.driver === 'postgres') {
    const pool = new Pool({ connectionString: config.persistence.pgUrl });
    const store = new PostgresEventStore(pool);
    await store.init();
    return instrumentEventStore(store, metrics, 'postgres');
  }
  if (config.persistence.driver === 'sqlite') {
    return instrumentEventStore(
      new SqliteEventStore(config.persistence.sqlitePath),
      metrics,
      'sqlite'
    );
  }
  return instrumentEventStore(new InMemoryEventStore(), metrics, 'memory');
};
