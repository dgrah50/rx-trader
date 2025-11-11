import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import {
  FeedType,
  StrategyType,
  parseFeedType,
  parseStrategyType
} from '@rx-trader/core/constants';
import { safeParse } from '@rx-trader/core/validation';
import type { RebalanceTarget } from '@rx-trader/portfolio/rebalancer/types';

const DEFAULT_CONFIG_FILENAME = 'rx.config.json';

loadEnv();

const booleanEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('rx-trader'),
  VERSION: z.string().default('0.1.0'),
  GATEWAY_PORT: z.coerce.number().default(8080),
  ORCHESTRATOR_PORT: z.coerce.number().default(8090),
  PG_URL: z.string().url().default('postgres://postgres:postgres@localhost:5432/rxtrader'),
  SQLITE_PATH: z.string().default('rxtrader.sqlite'),
  MARKET_STRUCTURE_SQLITE_PATH: z.string().default('market-structure.sqlite'),
  PERSIST_QUEUE_CAPACITY: z.coerce.number().default(65536),
  EVENT_STORE_DRIVER: z.enum(['memory', 'postgres', 'sqlite']).default('memory'),
  OTLP_URL: z.string().url().default('http://localhost:4318'),
  PROMETHEUS_PORT: z.coerce.number().default(9464),
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  BINANCE_API_BASE: z.string().url().default('https://api.binance.com'),
  HYPERLIQUID_API_KEY: z.string().optional(),
  HYPERLIQUID_API_SECRET: z.string().optional(),
  HYPERLIQUID_API_BASE: z.string().url().default('https://api.hyperliquid.xyz'),
  HYPERLIQUID_WALLET_ADDRESS: z.string().optional(),
  HYPERLIQUID_SUBACCOUNT: z.coerce.number().optional(),
  SPOT_MARGIN_ENABLED: booleanEnv.default(false),
  SPOT_MARGIN_LEVERAGE: z.coerce.number().default(1),
  STRATEGY_TYPE: z.string().default(StrategyType.Pair),
  STRATEGY_TRADE_SYMBOL: z.string().default('BTCUSDT'),
  STRATEGY_PRIMARY_FEED: z.string().default(FeedType.Binance),
  STRATEGY_EXTRA_FEEDS: z.string().default(''),
  STRATEGY_PARAMS: z.string().default('{}'),
  STRATEGIES: z.string().default(''),
  RISK_NOTIONAL_LIMIT: z.coerce.number().default(1_000_000),
  RISK_MAX_POSITION: z.coerce.number().default(1),
  RISK_PRICE_BAND_MIN: z.coerce.number().default(0),
  RISK_PRICE_BAND_MAX: z.coerce.number().default(Number.MAX_SAFE_INTEGER),
  RISK_THROTTLE_WINDOW_MS: z.coerce.number().default(5_000),
  RISK_THROTTLE_MAX_COUNT: z.coerce.number().default(1),
  ACCOUNT_ID: z.string().default('DEMO'),
  INTENT_MODE: z.enum(['market', 'limit', 'makerPreferred', 'takerOnDrift']).default('market'),
  INTENT_DEFAULT_QTY: z.coerce.number().default(1),
  INTENT_LIMIT_OFFSET_BPS: z.coerce.number().default(0),
  INTENT_MIN_EDGE_BPS: z.coerce.number().default(0),
  MAKER_FEE_BPS: z.coerce.number().default(0),
  TAKER_FEE_BPS: z.coerce.number().default(0),
  INTENT_TIF: z.enum(['IOC', 'FOK', 'DAY']).default('DAY'),
  INTENT_NOTIONAL_USD: z.coerce.number().default(0),
  INTENT_TAKER_SLIP_BPS: z.coerce.number().default(0),
  INTENT_ADVERSE_SELECTION_BPS: z.coerce.number().default(0),
  INTENT_POST_ONLY: booleanEnv.default(false),
  INTENT_REDUCE_ONLY: booleanEnv.default(false),
  INTENT_COOLDOWN_MS: z.coerce.number().default(0),
  INTENT_DEDUPE_WINDOW_MS: z.coerce.number().default(0),
  INTENT_MAKER_TIMEOUT_MS: z.coerce.number().default(0),
  INTENT_REPRICE_BPS: z.coerce.number().default(0),
  EXEC_RETRY_MAX_ATTEMPTS: z.coerce.number().default(3),
  EXEC_RETRY_BASE_DELAY_MS: z.coerce.number().default(200),
  EXEC_RETRY_MAX_DELAY_MS: z.coerce.number().default(2_000),
  EXEC_RETRY_JITTER: z.coerce.number().default(0.2),
  EXEC_CB_FAILURE_THRESHOLD: z.coerce.number().default(5),
  EXEC_CB_COOLDOWN_MS: z.coerce.number().default(30_000),
  EXEC_CB_HALF_OPEN_MAX_SUCCESSES: z.coerce.number().default(2),
  EXEC_RECON_ACK_TIMEOUT_MS: z.coerce.number().default(2_000),
  EXEC_RECON_FILL_TIMEOUT_MS: z.coerce.number().default(10_000),
  EXEC_RECON_POLL_INTERVAL_MS: z.coerce.number().default(1_000),
  CONTROL_PLANE_TOKEN: z.string().optional(),
  CONTROL_PLANE_RATE_WINDOW_MS: z.coerce.number().default(1000),
  CONTROL_PLANE_RATE_MAX: z.coerce.number().default(50),
  DASHBOARD_DIST_DIR: z.string().optional(),
  BALANCE_SYNC_INTERVAL_MS: z.coerce.number().default(60_000),
  BALANCE_SYNC_DRIFT_BPS: z.coerce.number().default(200),
  BALANCE_SYNC_MUTATES_LEDGER: booleanEnv.default(false),
  ACCOUNTING_DEMO_BALANCE: z.coerce.number().default(1_000),
  REBALANCER_TARGETS: z.string().default('[]'),
  REBALANCER_INTERVAL_MS: z.coerce.number().default(300_000),
  REBALANCER_AUTO_EXECUTE: booleanEnv.default(false),
  REBALANCER_EXECUTOR_MODE: z
    .enum(['manual', 'mock', 'binance', 'hyperliquid'])
    .default('manual')
});

export type EnvOverrides = Partial<Record<keyof z.infer<typeof envSchema>, string>>;

export type AppConfig = ReturnType<typeof mapEnvToConfig>;

const KNOWN_ENV_KEYS = new Set(Object.keys(envSchema.shape));

const toEnvString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

const parseConfigFile = (filePath: string): EnvOverrides => {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${path.basename(filePath)}: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path.basename(filePath)} must contain a JSON object of key/value pairs.`);
  }

  const overrides: EnvOverrides = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === undefined || value === null) {
      continue;
    }
    const upperKey = key.toUpperCase();
    if (!KNOWN_ENV_KEYS.has(upperKey)) {
      console.warn(`[config] Ignoring unknown key "${key}" in ${path.basename(filePath)}`);
      continue;
    }
    overrides[upperKey as keyof z.infer<typeof envSchema>] = toEnvString(value);
  }
  return overrides;
};

interface JsonOverridesResult {
  overrides: EnvOverrides;
  filePath?: string;
}

const loadJsonConfigOverrides = (): JsonOverridesResult => {
  const explicitPath = process.env.RX_CONFIG_PATH ?? process.env.RX_CONFIG;
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`RX_CONFIG_PATH points to "${explicitPath}" but the file does not exist.`);
    }
    return { overrides: parseConfigFile(resolved), filePath: resolved };
  }

  const defaultPath = path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);
  if (fs.existsSync(defaultPath)) {
    return { overrides: parseConfigFile(defaultPath), filePath: defaultPath };
  }

  return { overrides: {} };
};

type ConfigValueSource = 'default' | 'env' | 'file' | 'override';

interface ConfigValueMeta {
  source: ConfigValueSource;
  rawValue?: string;
}

interface LoadedConfigDetails {
  config: AppConfig;
  env: z.infer<typeof envSchema>;
  inputs: Record<keyof z.infer<typeof envSchema>, string | undefined>;
  sources: Record<keyof z.infer<typeof envSchema>, ConfigValueMeta>;
  configFilePath?: string;
}

const collectInputs = (
  overrides: EnvOverrides,
  fileResult: JsonOverridesResult
): {
  inputs: Record<keyof z.infer<typeof envSchema>, string | undefined>;
  sources: Record<keyof z.infer<typeof envSchema>, ConfigValueMeta>;
} => {
  const inputs: Record<string, string | undefined> = {};
  const sources: Record<string, ConfigValueMeta> = {};
  const fileOverrides = fileResult.overrides;

  for (const key of Object.keys(envSchema.shape)) {
    if (overrides[key as keyof typeof overrides] !== undefined) {
      const value = overrides[key as keyof typeof overrides];
      inputs[key] = value;
      sources[key] = { source: 'override', rawValue: value };
      continue;
    }
    if (process.env[key] !== undefined) {
      const value = process.env[key];
      inputs[key] = value;
      sources[key] = { source: 'env', rawValue: value };
      continue;
    }
    if (fileOverrides[key as keyof typeof fileOverrides] !== undefined) {
      const value = fileOverrides[key as keyof typeof fileOverrides];
      inputs[key] = value;
      sources[key] = { source: 'file', rawValue: value };
      continue;
    }
    inputs[key] = undefined;
    sources[key] = { source: 'default' };
  }

  return {
    inputs: inputs as Record<keyof z.infer<typeof envSchema>, string | undefined>,
    sources: sources as Record<keyof z.infer<typeof envSchema>, ConfigValueMeta>
  };
};

const mapEnvToConfig = (env: z.infer<typeof envSchema>) => ({
  app: {
    env: env.NODE_ENV,
    name: env.APP_NAME,
    version: env.VERSION
  },
  gateway: {
    port: env.GATEWAY_PORT
  },
  orchestrator: {
    port: env.ORCHESTRATOR_PORT
  },
  persistence: {
    pgUrl: env.PG_URL,
    sqlitePath: env.SQLITE_PATH,
    driver: env.EVENT_STORE_DRIVER,
    queueCapacity: env.PERSIST_QUEUE_CAPACITY
  },
  marketStructure: {
    sqlitePath: env.MARKET_STRUCTURE_SQLITE_PATH
  },
  observability: {
    otlpUrl: env.OTLP_URL,
    metricsPort: env.PROMETHEUS_PORT
  },
  execution: {
    account: env.ACCOUNT_ID,
    policy: {
      mode: env.INTENT_MODE,
      defaultQty: env.INTENT_DEFAULT_QTY,
      limitOffsetBps: env.INTENT_LIMIT_OFFSET_BPS,
      minEdgeBps: env.INTENT_MIN_EDGE_BPS,
      makerFeeBps: env.MAKER_FEE_BPS,
      takerFeeBps: env.TAKER_FEE_BPS,
      tif: env.INTENT_TIF,
      notionalUsd: env.INTENT_NOTIONAL_USD,
      takerSlipBps: env.INTENT_TAKER_SLIP_BPS,
      adverseSelectionBps: env.INTENT_ADVERSE_SELECTION_BPS,
      postOnly: env.INTENT_POST_ONLY,
      reduceOnly: env.INTENT_REDUCE_ONLY,
      cooldownMs: env.INTENT_COOLDOWN_MS,
      dedupeWindowMs: env.INTENT_DEDUPE_WINDOW_MS,
      makerTimeoutMs: env.INTENT_MAKER_TIMEOUT_MS,
      repriceBps: env.INTENT_REPRICE_BPS
    },
    reliability: {
      retry: {
        maxAttempts: env.EXEC_RETRY_MAX_ATTEMPTS,
        baseDelayMs: env.EXEC_RETRY_BASE_DELAY_MS,
        maxDelayMs: env.EXEC_RETRY_MAX_DELAY_MS,
        jitter: env.EXEC_RETRY_JITTER
      },
      circuitBreaker: {
        failureThreshold: env.EXEC_CB_FAILURE_THRESHOLD,
        cooldownMs: env.EXEC_CB_COOLDOWN_MS,
        halfOpenMaxSuccesses: env.EXEC_CB_HALF_OPEN_MAX_SUCCESSES
      },
      reconciliation: {
        ackTimeoutMs: env.EXEC_RECON_ACK_TIMEOUT_MS,
        fillTimeoutMs: env.EXEC_RECON_FILL_TIMEOUT_MS,
        pollIntervalMs: env.EXEC_RECON_POLL_INTERVAL_MS
      }
    }
  },
  controlPlane: {
    authToken: env.CONTROL_PLANE_TOKEN,
    rateLimit: {
      windowMs: env.CONTROL_PLANE_RATE_WINDOW_MS,
      max: env.CONTROL_PLANE_RATE_MAX
    },
    dashboard: {
      distDir: env.DASHBOARD_DIST_DIR
    }
  },
  accounting: {
    balanceSyncIntervalMs: env.BALANCE_SYNC_INTERVAL_MS,
    balanceSyncMaxDriftBps: env.BALANCE_SYNC_DRIFT_BPS,
    balanceSyncMutatesLedger: env.BALANCE_SYNC_MUTATES_LEDGER,
    seedDemoBalance: env.ACCOUNTING_DEMO_BALANCE
  },
  rebalancer: {
    intervalMs: env.REBALANCER_INTERVAL_MS,
    targets: parseRebalanceTargets(env.REBALANCER_TARGETS),
    executor: {
      auto: env.REBALANCER_AUTO_EXECUTE,
      mode: env.REBALANCER_EXECUTOR_MODE
    }
  } satisfies RebalancerConfig,
  venues: {
    binance:
      env.BINANCE_API_KEY && env.BINANCE_API_SECRET
        ? {
            apiKey: env.BINANCE_API_KEY,
            apiSecret: env.BINANCE_API_SECRET,
            baseUrl: env.BINANCE_API_BASE
          }
        : undefined,
    hyperliquid:
      env.HYPERLIQUID_API_KEY && env.HYPERLIQUID_API_SECRET
        ? {
            apiKey: env.HYPERLIQUID_API_KEY,
            apiSecret: env.HYPERLIQUID_API_SECRET,
            baseUrl: env.HYPERLIQUID_API_BASE,
            walletAddress: env.HYPERLIQUID_WALLET_ADDRESS,
            subaccount: env.HYPERLIQUID_SUBACCOUNT
          }
        : env.HYPERLIQUID_WALLET_ADDRESS
        ? {
            apiKey: undefined,
            apiSecret: undefined,
            baseUrl: env.HYPERLIQUID_API_BASE,
            walletAddress: env.HYPERLIQUID_WALLET_ADDRESS,
            subaccount: env.HYPERLIQUID_SUBACCOUNT
          }
        : undefined
  },
  margin: {
    spot: {
      enabled: env.SPOT_MARGIN_ENABLED,
      leverageCap: env.SPOT_MARGIN_LEVERAGE
    }
  },
  strategies: buildStrategiesConfig(env),
  risk: buildRiskConfig(env)
});

const parseJson = (value: string, label: string): Record<string, unknown> => {
  try {
    return value.trim() ? (JSON.parse(value) as Record<string, unknown>) : {};
  } catch (error) {
    throw new Error(`Invalid JSON for ${label}: ${(error as Error).message}`);
  }
};

const parseExtraFeeds = (raw: string): FeedType[] =>
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parseFeedType(entry));

const buildStrategyConfig = (env: z.infer<typeof envSchema>) => {
  const type = parseStrategyType(env.STRATEGY_TYPE);
  const primaryFeed = parseFeedType(env.STRATEGY_PRIMARY_FEED);
  const extraFeeds = parseExtraFeeds(env.STRATEGY_EXTRA_FEEDS);
  const params = parseJson(env.STRATEGY_PARAMS, 'STRATEGY_PARAMS');

  return {
    type,
    tradeSymbol: env.STRATEGY_TRADE_SYMBOL.toUpperCase(),
    primaryFeed,
    extraFeeds,
    params
} satisfies StrategyConfig;
};

const buildStrategiesConfig = (env: z.infer<typeof envSchema>) => {
  const baseStrategy = buildStrategyConfig(env);
  const baseRisk = buildRiskConfig(env);
  const parsed = parseStrategies(env.STRATEGIES, baseStrategy, baseRisk);
  return parsed;
};

const buildRiskConfig = (env: z.infer<typeof envSchema>) => {
  const tradeSymbol = env.STRATEGY_TRADE_SYMBOL.toUpperCase();
  return {
    notional: env.RISK_NOTIONAL_LIMIT,
    maxPosition: env.RISK_MAX_POSITION,
    priceBands: {
      [tradeSymbol]: { min: env.RISK_PRICE_BAND_MIN, max: env.RISK_PRICE_BAND_MAX }
    },
    throttle: {
      windowMs: env.RISK_THROTTLE_WINDOW_MS,
      maxCount: env.RISK_THROTTLE_MAX_COUNT
    }
  } satisfies RiskConfig;
};

const parseJsonArray = (raw: string, label: string): unknown[] => {
  try {
    const parsed = raw.trim() ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be an array`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid JSON for ${label}: ${(error as Error).message}`);
  }
};

const parseRebalanceTargets = (raw: string): RebalanceTarget[] => {
  try {
    return parseJsonArray(raw, 'REBALANCER_TARGETS').map((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error('Each rebalance target must be an object');
      }
      const { venue, asset, min, max, target, priority } = entry as Record<string, unknown>;
      if (typeof venue !== 'string' || !venue) {
        throw new Error('Rebalance target missing venue');
      }
      if (typeof asset !== 'string' || !asset) {
        throw new Error('Rebalance target missing asset');
      }
      return {
        venue,
        asset,
        min: typeof min === 'number' ? min : undefined,
        max: typeof max === 'number' ? max : undefined,
        target: typeof target === 'number' ? target : undefined,
        priority: typeof priority === 'number' ? priority : undefined
      } satisfies RebalanceTarget;
    });
  } catch (error) {
    throw error;
  }
};

const parseStrategies = (
  raw: string,
  fallbackStrategy: StrategyConfig,
  fallbackRisk: RiskConfig
): StrategyDefinition[] => {
  if (!raw.trim()) {
    return [createFallbackStrategyDefinition(fallbackStrategy, fallbackRisk)];
  }

  const entries = parseJsonArray(raw, 'STRATEGIES');
  if (!entries.length) {
    return [createFallbackStrategyDefinition(fallbackStrategy, fallbackRisk)];
  }

  const seenIds = new Set<string>();
  const definitions = entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`STRATEGIES[${index}] must be an object`);
    }
    return normalizeStrategyDefinition(entry as Record<string, unknown>, fallbackStrategy, fallbackRisk, index);
  });

  for (const def of definitions) {
    if (seenIds.has(def.id)) {
      throw new Error(`Duplicate strategy id '${def.id}' in STRATEGIES`);
    }
    seenIds.add(def.id);
  }

  return definitions;
};

const normalizeStrategyDefinition = (
  entry: Record<string, unknown>,
  fallbackStrategy: StrategyConfig,
  fallbackRisk: RiskConfig,
  index: number
): StrategyDefinition => {
  const id = typeof entry.id === 'string' && entry.id.trim().length ? entry.id.trim() : undefined;
  if (!id) {
    throw new Error(`STRATEGIES[${index}].id is required`);
  }

  const type = typeof entry.type === 'string' ? parseStrategyType(entry.type) : fallbackStrategy.type;
  const tradeSymbolRaw = typeof entry.tradeSymbol === 'string' ? entry.tradeSymbol : fallbackStrategy.tradeSymbol;
  const tradeSymbol = tradeSymbolRaw.toUpperCase();
  const primaryFeed = typeof entry.primaryFeed === 'string'
    ? parseFeedType(entry.primaryFeed)
    : fallbackStrategy.primaryFeed;
  const extraFeeds = Array.isArray(entry.extraFeeds)
    ? entry.extraFeeds.map((feed, feedIdx) => {
        if (typeof feed !== 'string') {
          throw new Error(`STRATEGIES[${index}].extraFeeds[${feedIdx}] must be a string`);
        }
        return parseFeedType(feed);
      })
    : fallbackStrategy.extraFeeds;

  const params = (entry.params && typeof entry.params === 'object' && !Array.isArray(entry.params)
    ? (entry.params as Record<string, unknown>)
    : fallbackStrategy.params) ?? {};

  const mode = entry.mode === 'sandbox' ? 'sandbox' : 'live';
  const priority = typeof entry.priority === 'number' ? entry.priority : 0;

  const baseBudget = {
    notional: fallbackRisk.notional,
    maxPosition: fallbackRisk.maxPosition,
    throttle: { ...fallbackRisk.throttle }
  };

  const budget = normalizeBudget(entry.budget, baseBudget);

  return {
    id,
    mode,
    priority,
    type,
    tradeSymbol,
    primaryFeed,
    extraFeeds,
    params,
    budget
  } satisfies StrategyDefinition;
};

const normalizeBudget = (
  rawBudget: unknown,
  baseBudget: Required<StrategyBudgetConfig>
): StrategyBudgetConfig => {
  if (!rawBudget || typeof rawBudget !== 'object' || Array.isArray(rawBudget)) {
    return baseBudget;
  }
  const budget = rawBudget as Record<string, unknown>;
  const notional = typeof budget.notional === 'number' ? budget.notional : baseBudget.notional;
  const maxPosition = typeof budget.maxPosition === 'number' ? budget.maxPosition : baseBudget.maxPosition;
  let throttle = baseBudget.throttle;
  if (budget.throttle && typeof budget.throttle === 'object' && !Array.isArray(budget.throttle)) {
    const rawThrottle = budget.throttle as Record<string, unknown>;
    throttle = {
      windowMs: typeof rawThrottle.windowMs === 'number' ? rawThrottle.windowMs : baseBudget.throttle.windowMs,
      maxCount: typeof rawThrottle.maxCount === 'number' ? rawThrottle.maxCount : baseBudget.throttle.maxCount
    };
  }
  return { notional, maxPosition, throttle } satisfies StrategyBudgetConfig;
};

const createFallbackStrategyDefinition = (
  strategy: StrategyConfig,
  risk: RiskConfig
): StrategyDefinition => ({
  id: 'default',
  mode: 'live',
  priority: 0,
  type: strategy.type,
  tradeSymbol: strategy.tradeSymbol,
  primaryFeed: strategy.primaryFeed,
  extraFeeds: strategy.extraFeeds,
  params: strategy.params,
  budget: {
    notional: risk.notional,
    maxPosition: risk.maxPosition,
    throttle: { ...risk.throttle }
  }
});

export interface StrategyConfig {
  type: StrategyType;
  tradeSymbol: string;
  primaryFeed: FeedType;
  extraFeeds: FeedType[];
  params: Record<string, unknown>;
}

interface RiskConfig {
  notional: number;
  maxPosition: number;
  priceBands: Record<string, { min: number; max: number }>;
  throttle: { windowMs: number; maxCount: number };
}

interface RebalancerConfig {
  intervalMs: number;
  targets: RebalanceTarget[];
  executor: {
    auto: boolean;
    mode: 'manual' | 'mock' | 'binance' | 'hyperliquid';
  };
}

export interface ExecutionPolicyConfig {
  mode: 'market' | 'limit' | 'makerPreferred' | 'takerOnDrift';
  defaultQty: number;
  limitOffsetBps: number;
  minEdgeBps: number;
  makerFeeBps: number;
  takerFeeBps: number;
  tif: 'IOC' | 'FOK' | 'DAY';
  notionalUsd: number;
  takerSlipBps: number;
  adverseSelectionBps: number;
  postOnly: boolean;
  reduceOnly: boolean;
  cooldownMs: number;
  dedupeWindowMs: number;
  makerTimeoutMs: number;
  repriceBps: number;
}

interface ExecutionConfig {
  account: string;
  policy: ExecutionPolicyConfig;
}

export type StrategyMode = 'live' | 'sandbox';

export interface StrategyBudgetConfig {
  notional?: number;
  maxPosition?: number;
  throttle?: {
    windowMs: number;
    maxCount: number;
  };
}

export interface StrategyDefinition extends StrategyConfig {
  id: string;
  mode: StrategyMode;
  priority: number;
  budget: StrategyBudgetConfig;
}

export const loadConfigDetails = (overrides: EnvOverrides = {}): LoadedConfigDetails => {
  const fileResult = loadJsonConfigOverrides();
  const { inputs, sources } = collectInputs(overrides, fileResult);
  const env = safeParse(envSchema, inputs, { force: true });
  return {
    config: mapEnvToConfig(env),
    env,
    inputs,
    sources,
    configFilePath: fileResult.filePath
  };
};

export const loadConfig = (overrides: EnvOverrides = {}) => {
  return loadConfigDetails(overrides).config;
};
