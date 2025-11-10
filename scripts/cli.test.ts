import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildProgram } from './cli';
import { createMarketStructureStore, MarketStructureRepository } from '@rx-trader/market-structure';
import { createEventStore } from '@rx-trader/event-store';
import { loadConfig } from '@rx-trader/config';

const originalEnv = { ...process.env };

const resetEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
};

describe('CLI smoke tests', () => {
  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it('runs backtest command end-to-end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rx-cli-backtest-'));
    const dataPath = join(dir, 'ticks.json');
    const outPath = join(dir, 'result.json');
    const baseTime = Date.now();
    const ticks = [100, 99, 98, 105, 104].map((px, idx) => ({
      t: baseTime + idx + 1,
      symbol: 'SIM',
      last: px,
      bid: px - 0.1,
      ask: px + 0.1
    }));
    writeFileSync(dataPath, JSON.stringify(ticks));

    const program = buildProgram();
    await program.parseAsync([
      'node',
      'cli',
      'backtest',
      '--data',
      dataPath,
      '--out',
      outPath,
      '--symbol',
      'SIM',
      '--strategy',
      'momentum',
      '--params',
      '{"fastWindow":1,"slowWindow":3}'
    ]);

    const result = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(result.summary?.dataset?.format).toBe('json');
    expect(Array.isArray(result.navCurve)).toBe(true);
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.summary?.maxDrawdown).toBeTypeOf('number');
    expect(result.summary?.sharpe).toBeTypeOf('number');
    expect(result.stats?.ticksProcessed).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs market:sync with mocked fetch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rx-cli-market-'));
    const sqlitePath = resolve(join(dir, 'market.sqlite'));
    process.env.SQLITE_PATH = sqlitePath;
    process.env.MARKET_STRUCTURE_SQLITE_PATH = sqlitePath;
    process.env.EVENT_STORE_DRIVER = 'sqlite';

    const sample = {
      symbols: [
        {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          baseAssetPrecision: 8,
          quotePrecision: 8,
          pricePrecision: 2,
          quantityPrecision: 4,
          status: 'TRADING',
          filters: [
            { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '10' },
            { filterType: 'PRICE_FILTER', tickSize: '0.01' }
          ]
        }
      ]
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sample
    } as Response);

    const program = buildProgram();
    await program.parseAsync(['node', 'cli', 'data', 'sync', '--exchange', 'binance']);

    const store = createMarketStructureStore(sqlitePath);
    const repo = new MarketStructureRepository(store.db);
    const pair = await repo.getExchangePair('binance', 'BTCUSDT');
    expect(pair).not.toBeNull();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints the config in JSON mode', async () => {
    const program = buildProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'cli', 'config', 'print', '--json']);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('validates the config', async () => {
    const program = buildProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'cli', 'config', 'validate']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^Configuration OK/));
    logSpy.mockRestore();
  });

  it('runs setup in dry-run mode', async () => {
    const program = buildProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'cli', 'setup', '--dry-run']);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('seeds an account balance adjustment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rx-cli-account-'));
    const sqlitePath = resolve(join(dir, 'account.sqlite'));
    process.env.EVENT_STORE_DRIVER = 'sqlite';
    process.env.SQLITE_PATH = sqlitePath;

    const program = buildProgram();
    await program.parseAsync([
      'node',
      'cli',
      'account',
      'seed',
      '--amount',
      '1000',
      '--asset',
      'USD',
      '--venue',
      'paper',
      '--account-id',
      'TEST'
    ]);

    const store = await createEventStore(loadConfig());
    const events = await store.read();
    (store as unknown as { close?: () => Promise<void> | void }).close?.();
    const balanceEvent = events.find((event) => event.type === 'account.balance.adjusted');
    expect(balanceEvent).toBeTruthy();
    expect((balanceEvent as any).data.accountId).toBe('TEST');
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints a rebalance plan', async () => {
    process.env.REBALANCER_TARGETS = '[{"venue":"paper","asset":"USD","min":1000}]';
    const program = buildProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'cli', 'account', 'rebalance']);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('records a transfer', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'cli',
      'account',
      'transfer',
      '--from-venue',
      'paper',
      '--to-venue',
      'binance',
      '--asset',
      'USD',
      '--amount',
      '10'
    ]);
  });
});
