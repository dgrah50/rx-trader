import { Database } from 'bun:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import type { Statement } from 'bun:sqlite';
import { Subject } from 'rxjs';
import { validateDomainEvent } from '@rx-trader/core/domain';
import type { DomainEvent } from '@rx-trader/core/domain';
import type { EventStore } from './eventStore';

interface SqliteEventStoreOptions {
  tableName?: string;
  busyTimeoutMs?: number;
}

const SQLITE_BUSY = 'SQLITE_BUSY';
const MAX_RETRIES = 5;

export class SqliteEventStore implements EventStore {
  public readonly stream$ = new Subject<DomainEvent>();
  private readonly db: Database;
  private readonly table: string;
  private readonly insertStmt: Statement<Record<string, unknown>>;

  constructor(file: string, options: SqliteEventStoreOptions = {}) {
    this.table = options.tableName ?? 'events';
    this.db = new Database(file, { create: true });
    this.db.exec('PRAGMA journal_mode=WAL;');
    this.db.exec('PRAGMA synchronous=NORMAL;');
    const busyTimeout = options.busyTimeoutMs ?? 5000;
    this.db.exec(`PRAGMA busy_timeout=${busyTimeout};`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        ts INTEGER NOT NULL,
        metadata TEXT
      )
    `);
    const columns = this.db.query(`PRAGMA table_info(${this.table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'dedupe_key')) {
      this.db.run(`ALTER TABLE ${this.table} ADD COLUMN dedupe_key TEXT`);
    }
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_${this.table}_ts ON ${this.table}(ts)`);
    this.db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_${this.table}_dedupe_key
       ON ${this.table}(dedupe_key) WHERE dedupe_key IS NOT NULL`,
    );
    this.insertStmt = this.db.prepare(
      `INSERT INTO ${this.table} (id, dedupe_key, type, data, ts, metadata)
       VALUES ($id, $dedupeKey, $type, $data, $ts, $metadata)
       ON CONFLICT DO NOTHING`,
    );
  }

  async append(eventOrEvents: DomainEvent | DomainEvent[]) {
    const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const inserted: DomainEvent[] = [];
        const tx = this.db.transaction((batch: DomainEvent[]) => {
          batch.forEach((event) => {
            const validated = validateDomainEvent(event);
            const result = this.insertStmt.run({
              $id: validated.id,
              $dedupeKey: validated.dedupeKey ?? null,
              $type: validated.type,
              $data: JSON.stringify(validated.data),
              $ts: validated.ts,
              $metadata: validated.metadata ? JSON.stringify(validated.metadata) : null
            });
            if (result.changes > 0) inserted.push(validated);
          });
        });
        tx(events);
        inserted.forEach((event) => this.stream$.next(event));
        return;
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (code === SQLITE_BUSY && attempt < MAX_RETRIES - 1) {
          await wait(50 * (attempt + 1));
          continue;
        }
        throw error;
      }
    }
  }

  async read(after?: number): Promise<DomainEvent[]> {
    const where = after !== undefined ? `WHERE ts > $after` : '';
    const stmt = this.db.prepare(
      `SELECT id, dedupe_key, type, data, ts, metadata
       FROM ${this.table} ${where} ORDER BY ts ASC, id ASC`,
    );
    type Row = {
      id: string;
      dedupe_key?: string | null;
      type: string;
      data: string;
      ts: number;
      metadata?: string | null;
    };
    const rows: Row[] =
      after !== undefined ? (stmt.all({ $after: after }) as Row[]) : (stmt.all() as Row[]);
    return rows.map((row) =>
      validateDomainEvent({
        id: row.id,
        dedupeKey: row.dedupe_key ?? undefined,
        type: row.type as DomainEvent['type'],
        data: JSON.parse(row.data),
        ts: row.ts,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
      })
    );
  }

  async readCommitted(afterCursor = 0) {
    const rows = this.db
      .prepare(
        `SELECT rowid AS sequence, id, dedupe_key, type, data, ts, metadata
         FROM ${this.table} WHERE rowid > $cursor ORDER BY rowid ASC`,
      )
      .all({ $cursor: afterCursor }) as Array<{
      sequence: number;
      id: string;
      dedupe_key?: string | null;
      type: string;
      data: string;
      ts: number;
      metadata?: string | null;
    }>;
    const events = rows.map((row) =>
      validateDomainEvent({
        id: row.id,
        dedupeKey: row.dedupe_key ?? undefined,
        type: row.type as DomainEvent['type'],
        data: JSON.parse(row.data),
        ts: row.ts,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }),
    );
    return { events, cursor: rows.at(-1)?.sequence ?? afterCursor };
  }

  async close() {
    this.db.close();
  }
}
