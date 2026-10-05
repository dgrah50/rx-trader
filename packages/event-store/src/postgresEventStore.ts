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
        sequence BIGSERIAL UNIQUE,
        id UUID PRIMARY KEY,
        dedupe_key TEXT,
        type TEXT NOT NULL,
        data JSONB NOT NULL,
        ts BIGINT NOT NULL,
        metadata JSONB
      );
      ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
      ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS sequence BIGSERIAL;
      CREATE INDEX IF NOT EXISTS idx_${this.table}_ts ON ${this.table}(ts);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_${this.table}_dedupe_key
        ON ${this.table}(dedupe_key) WHERE dedupe_key IS NOT NULL;
    `);
  }

  async append(eventOrEvents: DomainEvent | DomainEvent[]) {
    const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];
    const validatedEvents = events.map((event) => validateDomainEvent(event));
    const client = await this.pool.connect();
    const inserted: DomainEvent[] = [];
    try {
      await client.query('BEGIN');
      for (const validated of validatedEvents) {
        const result = await client.query(
          `INSERT INTO ${this.table} (id, dedupe_key, type, data, ts, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [
            validated.id,
            validated.dedupeKey ?? null,
            validated.type,
            JSON.stringify(validated.data),
            validated.ts,
            JSON.stringify(validated.metadata ?? null),
          ],
        );
        if (result.rowCount === 1) inserted.push(validated);
      }
      await client.query('COMMIT');
      inserted.forEach((event) => this.stream$.next(event));
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
      `SELECT id, dedupe_key, type, data, ts, metadata
       FROM ${this.table} ${where} ORDER BY ts ASC, id ASC`,
    );
    return result.rows.map((row) =>
      validateDomainEvent({
        id: row.id,
        dedupeKey: row.dedupe_key ?? undefined,
        type: row.type,
        data: row.data,
        ts: Number(row.ts),
        metadata: row.metadata ?? undefined
      })
    );
  }

  async readCommitted(afterCursor = 0) {
    const result = await this.pool.query(
      `SELECT sequence, id, dedupe_key, type, data, ts, metadata
       FROM ${this.table} WHERE sequence > $1 ORDER BY sequence ASC`,
      [afterCursor],
    );
    const events = result.rows.map((row) =>
      validateDomainEvent({
        id: row.id,
        dedupeKey: row.dedupe_key ?? undefined,
        type: row.type,
        data: row.data,
        ts: Number(row.ts),
        metadata: row.metadata ?? undefined,
      }),
    );
    return {
      events,
      cursor: result.rows.length ? Number(result.rows.at(-1).sequence) : afterCursor,
    };
  }

  async close() {
    await this.pool.end();
  }
}
