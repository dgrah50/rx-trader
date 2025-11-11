import { describe, expect, it, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadConfig, loadConfigDetails } from './index';

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
        STRATEGY_TRADE_SYMBOL: 'ethusdt',
        RISK_MAX_POSITION: 7,
        STRATEGY_PARAMS: { fastWindow: 5 }
      })
    );

    process.env.RX_CONFIG_PATH = filePath;
    process.env.STRATEGY_TRADE_SYMBOL = 'btcusdt';

    const config = loadConfig();
    expect(config.strategies[0]?.tradeSymbol).toBe('BTCUSDT');
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

    const details = loadConfigDetails({ INTENT_DEFAULT_QTY: '2' });
    expect(details.sources.RISK_MAX_POSITION.source).toBe('file');
    expect(details.sources.INTENT_MODE.source).toBe('env');
    expect(details.sources.INTENT_DEFAULT_QTY.source).toBe('override');
    expect(details.sources.STRATEGY_TRADE_SYMBOL.source).toBe('default');
    expect(details.configFilePath).toBe(filePath);

    unlinkSync(filePath);
  });

  it('falls back to a default strategy definition when STRATEGIES is empty', () => {
    const config = loadConfig();
    expect(config.strategies).toHaveLength(1);
    const [strategy] = config.strategies;
    expect(strategy.id).toBe('default');
    expect(strategy.mode).toBe('live');
    expect(strategy.tradeSymbol).toBe('BTCUSDT');
    expect(strategy.budget?.notional).toBe(config.risk.notional);
    expect(strategy.budget?.throttle?.windowMs).toBe(config.risk.throttle.windowMs);
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
        }
      },
      {
        id: 'arb',
        type: 'ARBITRAGE',
        tradeSymbol: 'ethusdt',
        primaryFeed: 'hyperliquid',
        extraFeeds: ['binance']
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
});
