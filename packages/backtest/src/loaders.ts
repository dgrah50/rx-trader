import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import type { MarketTick } from '@rx-trader/core/domain';
import { Database } from 'duckdb';

interface TickDatasetMetadata {
  format: 'json' | 'csv' | 'parquet';
  source: string;
  count: number;
  startTime: number;
  endTime: number;
  symbols: Record<string, number>;
}

interface TickDataset {
  ticks: MarketTick[];
  metadata: TickDatasetMetadata;
}

interface LoadTicksOptions {
  symbol?: string;
  limit?: number;
}

const summarize = (ticks: MarketTick[], format: TickDatasetMetadata['format'], source: string): TickDatasetMetadata => {
  const symbolCounts: Record<string, number> = {};
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const tick of ticks) {
    symbolCounts[tick.symbol] = (symbolCounts[tick.symbol] ?? 0) + 1;
    start = Math.min(start, tick.t);
    end = Math.max(end, tick.t);
  }
  return {
    format,
    source,
    count: ticks.length,
    startTime: start === Number.POSITIVE_INFINITY ? 0 : start,
    endTime: end === Number.NEGATIVE_INFINITY ? 0 : end,
    symbols: symbolCounts
  };
};

const sanitizePathForDuckDB = (filePath: string) => filePath.replace(/'/g, "''");

const sampleFile = (filePath: string, bytes = 2048): string => {
  try {
    const fd = openSync(resolve(filePath), 'r');
    const buffer = Buffer.alloc(bytes);
    const length = readSync(fd, buffer, 0, bytes, 0);
    closeSync(fd);
    return buffer.toString('utf8', 0, length);
  } catch {
    return '';
  }
};

const looksLikeBinanceKlines = (filePath: string): boolean => {
  try {
    const firstLine = sampleFile(filePath)
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0);
    if (!firstLine) return false;
    const parts = firstLine.split(',');
    if (parts.length < 12) return false;
    const hasLetters = /[a-zA-Z]/.test(firstLine);
    return !hasLetters;
  } catch {
    return false;
  }
};

const normalizeEpoch = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value > 1e14) {
    // Binance sometimes exports microseconds
    return Math.floor(value / 1000);
  }
  return value;
};

const inferSymbolFromPath = (filePath: string): string | null => {
  const base = resolve(filePath).split(/[\\/]/).pop() ?? '';
  const match = base.match(/([A-Z0-9]+)(?:-|_)/i);
  return match ? match[1]?.toUpperCase() ?? null : null;
};

const loadBinanceCsv = (
  filePath: string,
  options: LoadTicksOptions
): MarketTick[] => {
  const symbol = (options.symbol ?? inferSymbolFromPath(filePath) ?? 'UNKNOWN').toUpperCase();
  const raw = readFileSync(resolve(filePath), 'utf8');
  const ticks: MarketTick[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    if (cols.length < 12) continue;
    const openTime = normalizeEpoch(Number(cols[0]));
    const high = Number(cols[2]);
    const low = Number(cols[3]);
    const close = Number(cols[4]);
    if (!Number.isFinite(openTime) || !Number.isFinite(close)) continue;
    const tick: MarketTick = {
      t: openTime,
      symbol,
      bid: Number.isFinite(low) ? low : close,
      ask: Number.isFinite(high) ? high : close,
      last: close
    };
    if (options.symbol) {
      const target = options.symbol.toUpperCase();
      if (tick.symbol !== target) continue;
    }
    ticks.push(tick);
    if (options.limit && Number.isFinite(options.limit) && ticks.length >= options.limit) {
      break;
    }
  }
  return ticks;
};

const loadViaDuckDB = async (
  filePath: string,
  reader: 'read_csv_auto' | 'read_parquet',
  options: LoadTicksOptions
): Promise<MarketTick[]> => {
  const db = new Database(':memory:');
  const conn = db.connect();
  try {
    const escaped = sanitizePathForDuckDB(resolve(filePath));
    const filters: string[] = [];
    if (options.symbol) {
      const symbol = options.symbol.toUpperCase().replace(/'/g, "''");
      filters.push(`upper(symbol) = '${symbol}'`);
    }
    let query = `SELECT t, symbol, bid, ask, last FROM ${reader}('${escaped}')`;
    if (filters.length) {
      query += ` WHERE ${filters.join(' AND ')}`;
    }
    query += ' ORDER BY t';
    if (options.limit && Number.isFinite(options.limit)) {
      query += ` LIMIT ${options.limit}`;
    }
    const rows = await new Promise<Array<Record<string, unknown>>>((resolveRows, reject) => {
      conn.all(query, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolveRows(data as Array<Record<string, unknown>>);
        }
      });
    });
    return rows.map((row) => ({
      t: Number(row.t),
      symbol: String(row.symbol ?? '').toUpperCase(),
      bid: row.bid === null || row.bid === undefined ? undefined : Number(row.bid),
      ask: row.ask === null || row.ask === undefined ? undefined : Number(row.ask),
      last: row.last === null || row.last === undefined ? undefined : Number(row.last)
    })) as MarketTick[];
  } finally {
    conn.close();
    db.close();
  }
};

const loadFromJson = (filePath: string, options: LoadTicksOptions): MarketTick[] => {
  const raw = readFileSync(resolve(filePath), 'utf8');
  const parsed = JSON.parse(raw) as MarketTick[];
  let ticks = parsed.map((tick) => ({
    ...tick,
    symbol: tick.symbol.toUpperCase()
  }));
  if (options.symbol) {
    const target = options.symbol.toUpperCase();
    ticks = ticks.filter((tick) => tick.symbol === target);
  }
  if (options.limit && Number.isFinite(options.limit)) {
    ticks = ticks.slice(0, options.limit);
  }
  return ticks;
};

export const loadTicks = async (
  filePath: string,
  options: LoadTicksOptions = {}
): Promise<TickDataset> => {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.csv') {
    if (looksLikeBinanceKlines(filePath)) {
      const ticks = loadBinanceCsv(filePath, options);
      return { ticks, metadata: summarize(ticks, 'csv', resolve(filePath)) };
    }
    const ticks = await loadViaDuckDB(filePath, 'read_csv_auto', options);
    return { ticks, metadata: summarize(ticks, 'csv', resolve(filePath)) };
  }
  if (ext === '.parquet' || ext === '.pq') {
    const ticks = await loadViaDuckDB(filePath, 'read_parquet', options);
    return { ticks, metadata: summarize(ticks, 'parquet', resolve(filePath)) };
  }
  const ticks = loadFromJson(filePath, options);
  return { ticks, metadata: summarize(ticks, 'json', resolve(filePath)) };
};
