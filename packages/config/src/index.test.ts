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
    expect(config.strategy.tradeSymbol).toBe('BTCUSDT');
    expect(config.risk.maxPosition).toBe(7);
    expect((config.strategy.params as Record<string, unknown>).fastWindow).toBe(5);

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
});
