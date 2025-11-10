import type { Pool } from 'pg';
import type { MarketTick } from '@rx-trader/core/domain';

export class TimescaleWriter {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async persistTick(tick: MarketTick) {
    await this.pool.query(
      `INSERT INTO market_ticks (ts, symbol, bid, ask, last, bid_size, ask_size)
       VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6, $7)`,
      [tick.t, tick.symbol, tick.bid ?? null, tick.ask ?? null, tick.last ?? null, tick.bidSz ?? null, tick.askSz ?? null]
    );
  }
}
