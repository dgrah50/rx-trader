import { Subject } from 'rxjs';
import type { Pool } from 'pg';
import { validateDomainEvent } from '@rx-trader/core/domain';
import type { DomainEvent } from '@rx-trader/core/domain';

interface PostgresEventStoreOptions {
  tableName?: string;
}

export class PostgresEventStore {
  public readonly stream$ = new Subject<DomainEvent>();
  private readonly table: string;

  constructor(private readonly pool: Pool, options: PostgresEventStoreOptions = {}) {
    this.table = options.tableName ?? 'events';
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id UUID PRIMARY KEY,
        type TEXT NOT NULL,
        data JSONB NOT NULL,
        ts BIGINT NOT NULL,
        metadata JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_${this.table}_ts ON ${this.table}(ts);
    `);
  }

  async append(eventOrEvents: DomainEvent | DomainEvent[]) {
    const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const event of events) {
        const validated = validateDomainEvent(event);
        await client.query(
          `INSERT INTO ${this.table} (id, type, data, ts, metadata)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [validated.id, validated.type, JSON.stringify(validated.data), validated.ts, JSON.stringify(validated.metadata ?? null)]
        );
        this.stream$.next(validated);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async read(after?: number): Promise<DomainEvent[]> {
    const where =
      after !== undefined && Number.isFinite(after) ? `WHERE ts > ${Number(after)}` : '';
    const result = await this.pool.query(
      `SELECT id, type, data, ts, metadata FROM ${this.table} ${where} ORDER BY ts ASC`
    );
    return result.rows.map((row) =>
      validateDomainEvent({
        id: row.id,
        type: row.type,
        data: row.data,
        ts: Number(row.ts),
        metadata: row.metadata ?? undefined
      })
    );
  }

  async close() {
    await this.pool.end();
  }
}
