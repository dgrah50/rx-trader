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
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        ts INTEGER NOT NULL,
        metadata TEXT
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_${this.table}_ts ON ${this.table}(ts)`);
    this.insertStmt = this.db.prepare(
      `INSERT INTO ${this.table} (id, type, data, ts, metadata)
       VALUES ($id, $type, $data, $ts, $metadata)
       ON CONFLICT(id) DO NOTHING`
    );
  }

  async append(eventOrEvents: DomainEvent | DomainEvent[]) {
    const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const tx = this.db.transaction((batch: DomainEvent[]) => {
          batch.forEach((event) => {
            const validated = validateDomainEvent(event);
            this.insertStmt.run({
              $id: validated.id,
              $type: validated.type,
              $data: JSON.stringify(validated.data),
              $ts: validated.ts,
              $metadata: validated.metadata ? JSON.stringify(validated.metadata) : null
            });
            this.stream$.next(validated);
          });
        });
        tx(events);
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
      `SELECT id, type, data, ts, metadata FROM ${this.table} ${where} ORDER BY ts ASC`
    );
    type Row = { id: string; type: string; data: string; ts: number; metadata?: string | null };
    const rows: Row[] =
      after !== undefined ? (stmt.all({ $after: after }) as Row[]) : (stmt.all() as Row[]);
    return rows.map((row) =>
      validateDomainEvent({
        id: row.id,
        type: row.type as DomainEvent['type'],
        data: JSON.parse(row.data),
        ts: row.ts,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
      })
    );
  }

  async close() {
    this.db.close();
  }
}
