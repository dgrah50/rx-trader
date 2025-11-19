import { describe, expect, it, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DEFAULT_STRATEGIES, loadConfig, loadConfigDetails } from './index';

const ORIGINAL_ENV = { ...process.env };

const resetEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

describe('loadConfig', () => {
  afterEach(() => {
    resetEnv();
  });

  it('hydrates overrides from rx.config.json', () => {
    const filePath = path.join(tmpdir(), `rx-config-${randomUUID()}.json`);
    writeFileSync(
      filePath,
      JSON.stringify({
        STRATEGIES: [
          {
            id: 'file-strat',
            type: 'MOMENTUM',
            tradeSymbol: 'ethusdt',
            primaryFeed: 'binance',
            params: { fastWindow: 5 },
            exit: { enabled: false }
          }
        ],
        RISK_MAX_POSITION: 7,
        APP_NAME: 'rx-file'
      })
    );

    process.env.RX_CONFIG_PATH = filePath;

    const config = loadConfig();
    expect(config.app.name).toBe('rx-file');
    expect(config.strategies[0]?.tradeSymbol).toBe('ETHUSDT');
    expect(config.risk.maxPosition).toBe(7);
    expect((config.strategies[0]?.params as Record<string, unknown>).fastWindow).toBe(5);

    unlinkSync(filePath);
  });

  it('annotates config value sources', () => {
    const filePath = path.join(tmpdir(), `rx-config-${randomUUID()}.json`);
    writeFileSync(
      filePath,
      JSON.stringify({
        RISK_MAX_POSITION: 9,
        APP_NAME: 'rx-json'
      })
    );

    process.env.RX_CONFIG_PATH = filePath;
    process.env.INTENT_MODE = 'limit';

    const details = loadConfigDetails({
      INTENT_DEFAULT_QTY: '2',
      STRATEGIES: JSON.stringify([
        {
          id: 'env-strat',
          type: 'MOMENTUM',
          tradeSymbol: 'btcusdt',
          primaryFeed: 'binance',
          exit: { enabled: false }
        }
      ])
    });
    expect(details.sources.RISK_MAX_POSITION.source).toBe('file');
    expect(details.sources.INTENT_MODE.source).toBe('env');
    expect(details.sources.INTENT_DEFAULT_QTY.source).toBe('override');
    expect(details.sources.STRATEGIES.source).toBe('override');
    expect(details.configFilePath).toBe(filePath);

    unlinkSync(filePath);
  });

  it('falls back to bundled default strategies when STRATEGIES is empty', () => {
    delete process.env.STRATEGIES;
    const config = loadConfig();
    expect(config.strategies).toHaveLength(DEFAULT_STRATEGIES.length);
    const ids = config.strategies.map((s) => s.id);
    expect(ids).toEqual(DEFAULT_STRATEGIES.map((s) => s.id));
  });

  it('parses multiple strategies from STRATEGIES JSON', () => {
    process.env.STRATEGIES = JSON.stringify([
      {
        id: 'btc-momo',
        type: 'MOMENTUM',
        tradeSymbol: 'btcusdt',
        primaryFeed: 'binance',
        params: { fastWindow: 5 },
        priority: 7,
        mode: 'sandbox',
        budget: {
          notional: 250000,
          throttle: { windowMs: 500, maxCount: 2 }
        },
        exit: { enabled: false }
      },
      {
        id: 'arb',
        type: 'ARBITRAGE',
        tradeSymbol: 'ethusdt',
        primaryFeed: 'hyperliquid',
        extraFeeds: ['binance'],
        exit: { enabled: false }
      }
    ]);

    const config = loadConfig();
    expect(config.strategies).toHaveLength(2);
    const [first, second] = config.strategies;
    expect(first.id).toBe('btc-momo');
    expect(first.mode).toBe('sandbox');
    expect(first.priority).toBe(7);
    expect(first.tradeSymbol).toBe('BTCUSDT');
    expect(first.budget?.notional).toBe(250000);
    expect(first.budget?.throttle?.windowMs).toBe(500);
    expect(second.id).toBe('arb');
    expect(second.extraFeeds).toContain('binance');
    expect(second.budget?.notional).toBe(config.risk.notional);
  });

  it('parses per-strategy exit configs with defaults applied', () => {
    process.env.STRATEGIES = JSON.stringify([
      {
        id: 'exit-enabled',
        type: 'MOMENTUM',
        tradeSymbol: 'btcusdt',
        primaryFeed: 'binance',
        exit: {
          enabled: true,
          time: { enabled: true, maxHoldMs: 60000, minHoldMs: 5000 },
          tpSl: { enabled: true, tpSigma: 2 }
        }
      }
    ]);

    const config = loadConfig();
    const exit = config.strategies[0]?.exit;
    expect(exit?.enabled).toBe(true);
    expect(exit?.time?.maxHoldMs).toBe(60000);
    expect(exit?.time?.minHoldMs).toBe(5000);
    expect(exit?.tpSl?.tpSigma).toBe(2);
    expect(exit?.tpSl?.slSigma).toBe(1); // default applied
  });

  it('rejects invalid exit configs', () => {
    process.env.STRATEGIES = JSON.stringify([
      {
        id: 'exit-invalid',
        type: 'MOMENTUM',
        tradeSymbol: 'btcusdt',
        primaryFeed: 'binance',
        exit: {
          enabled: true,
          trailing: { enabled: true, retracePct: 1.5 }
        }
      }
    ]);

    expect(() => loadConfig()).toThrow(/STRATEGIES\[0\].exit/i);
  });

  it('requires each strategy to provide an exit config', () => {
    process.env.STRATEGIES = JSON.stringify([
      {
        id: 'missing-exit',
        type: 'MOMENTUM',
        tradeSymbol: 'btcusdt',
        primaryFeed: 'binance',
        params: {}
      }
    ]);

    expect(() => loadConfig()).toThrow(/exit is required/i);
  });
});
