import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { envSchema } from '../packages/config/src/index';

interface ConfigDocEntry {
  description: string;
  example?: string;
}

const CONFIG_DOCS: Record<string, ConfigDocEntry> = {
  NODE_ENV: {
    description: 'Bun/Node environment; controls logging format and validation strictness.',
    example: 'production'
  },
  APP_NAME: {
    description: 'Service name stamped into logs and metrics.',
    example: 'rx-trader'
  },
  VERSION: {
    description: 'Semantic version logged on startup and exposed via `/status`.',
    example: '0.2.0'
  },
  GATEWAY_PORT: {
    description: 'HTTP port for the control plane + dashboard proxy.',
    example: '8080'
  },
  ORCHESTRATOR_PORT: {
    description: 'Legacy gateway port (kept for backwards compatibility).',
    example: '8090'
  },
  PG_URL: { description: 'Postgres connection string when `EVENT_STORE_DRIVER=postgres`.' },
  SQLITE_PATH: {
    description: 'Path to the SQLite file backing the event store when `EVENT_STORE_DRIVER=sqlite`.',
    example: 'rxtrader.sqlite'
  },
  MARKET_STRUCTURE_SQLITE_PATH: {
    description: 'SQLite database storing market-structure metadata (tick/lot sizes, symbols).',
    example: 'market-structure.sqlite'
  },
  PERSIST_QUEUE_CAPACITY: {
    description:
      'Size of the shared-memory queue between the hot path and persistence worker (number of events).',
    example: '65536'
  },
  EVENT_STORE_DRIVER: {
    description: 'Event-store backend (`memory`, `sqlite`, or `postgres`).',
    example: 'sqlite'
  },
  OTLP_URL: { description: 'OTLP collector URL for traces/logs.' },
  PROMETHEUS_PORT: {
    description: 'Port exposing `/metrics` for Prometheus scrapes.',
    example: '9464'
  },
  BINANCE_API_KEY: { description: 'API key for Binance REST calls (balances, orders).' },
  BINANCE_API_SECRET: { description: 'API secret for Binance REST calls.' },
  BINANCE_API_BASE: {
    description: 'Binance REST base URL, useful for pointing to testnet/sandbox hosts.',
    example: 'https://api.binance.com'
  },
  HYPERLIQUID_API_KEY: { description: 'API key for Hyperliquid REST/WebSocket authenticated calls.' },
  HYPERLIQUID_API_SECRET: { description: 'API secret for Hyperliquid REST/WebSocket calls.' },
  HYPERLIQUID_API_BASE: {
    description: 'Hyperliquid REST base URL.',
    example: 'https://api.hyperliquid.xyz'
  },
  HYPERLIQUID_WALLET_ADDRESS: {
    description: 'Wallet address used to pull Hyperliquid balance snapshots.',
    example: '0xabc...'
  },
  HYPERLIQUID_SUBACCOUNT: {
    description: 'Optional Hyperliquid subaccount index for balance polling.',
    example: '0'
  },
  STRATEGY_TYPE: {
    description: 'Strategy implementation to run (momentum, pair, arbitrage, etc.).',
    example: 'pair'
  },
  STRATEGY_TRADE_SYMBOL: {
    description: 'Primary trading symbol used by the active strategy.',
    example: 'BTCUSDT'
  },
  STRATEGY_PRIMARY_FEED: {
    description: 'Feed identifier powering the main price stream (e.g., binance, hyperliquid).',
    example: 'binance'
  },
  STRATEGY_EXTRA_FEEDS: {
    description: 'Comma-separated list of auxiliary feeds consumed by multi-feed strategies.',
    example: 'hyperliquid,sentiment'
  },
  STRATEGY_PARAMS: {
    description: 'JSON blob passed directly to the selected strategy implementation.',
    example: '{"fastWindow":5,"slowWindow":20}'
  },
  RISK_NOTIONAL_LIMIT: {
    description: 'Maximum USD notional per order enforced by pre-trade risk.',
    example: '1000000'
  },
  RISK_MAX_POSITION: {
    description: 'Maximum absolute position size (in base units) allowed by risk.',
    example: '1'
  },
  RISK_PRICE_BAND_MIN: {
    description: 'Lower bound for acceptable trade prices (per symbol).',
    example: '0'
  },
  RISK_PRICE_BAND_MAX: {
    description: 'Upper bound for acceptable trade prices (per symbol).',
    example: '200000'
  },
  RISK_THROTTLE_WINDOW_MS: {
    description: 'Rolling window used by the risk throttle (milliseconds).',
    example: '5000'
  },
  RISK_THROTTLE_MAX_COUNT: {
    description: 'Maximum intents allowed within the throttle window.',
    example: '1'
  },
  ACCOUNT_ID: {
    description: 'Logical account identifier stamped on balance/transfer events.',
    example: 'DEMO'
  },
  INTENT_MODE: {
    description: 'Intent builder mode (`market`, `limit`, `makerPreferred`, `takerOnDrift`).',
    example: 'market'
  },
  INTENT_DEFAULT_QTY: { description: 'Fallback order quantity when strategy omit size.', example: '1' },
  INTENT_LIMIT_OFFSET_BPS: {
    description: 'Limit order offset in basis points applied when intent mode requires pricing.',
    example: '2'
  },
  INTENT_MIN_EDGE_BPS: {
    description: 'Minimum edge (bps) required to emit an intent.',
    example: '0'
  },
  MAKER_FEE_BPS: { description: 'Maker fee in basis points baked into intent edge math.' },
  TAKER_FEE_BPS: { description: 'Taker fee in basis points baked into intent edge math.' },
  INTENT_TIF: {
    description: 'Time-in-force for submitted orders (`IOC`, `FOK`, `DAY`).',
    example: 'DAY'
  },
  INTENT_NOTIONAL_USD: {
    description: 'Fixed USD notional target; overrides qty when > 0.',
    example: '0'
  },
  INTENT_TAKER_SLIP_BPS: {
    description: 'Assumed taker slippage (bps) when evaluating edges.',
    example: '0'
  },
  INTENT_ADVERSE_SELECTION_BPS: {
    description: 'Penalty (bps) for adverse selection, subtracted from computed edge.',
    example: '0'
  },
  INTENT_POST_ONLY: { description: 'Force maker orders to be post-only when true.' },
  INTENT_REDUCE_ONLY: { description: 'Set reduce-only flag on intents when true.' },
  INTENT_COOLDOWN_MS: {
    description: 'Per-symbol cooldown applied after emitting an intent.',
    example: '0'
  },
  INTENT_DEDUPE_WINDOW_MS: {
    description: 'Window for deduplicating identical intents.',
    example: '0'
  },
  INTENT_MAKER_TIMEOUT_MS: {
    description: 'Time limit for maker orders before they are considered stale.',
    example: '0'
  },
  INTENT_REPRICE_BPS: {
    description: 'Maker reprice offset in basis points when re-evaluating orders.',
    example: '0'
  },
  EXEC_RETRY_MAX_ATTEMPTS: {
    description: 'Maximum adapter submission retries before surfacing an error.',
    example: '3'
  },
  EXEC_RETRY_BASE_DELAY_MS: {
    description: 'Initial backoff delay between retries (ms).',
    example: '200'
  },
  EXEC_RETRY_MAX_DELAY_MS: {
    description: 'Maximum backoff delay (ms) between retries.',
    example: '2000'
  },
  EXEC_RETRY_JITTER: {
    description: 'Random jitter fraction applied to retry delays.',
    example: '0.2'
  },
  EXEC_CB_FAILURE_THRESHOLD: {
    description: 'Number of consecutive failures required to open the execution circuit.',
    example: '5'
  },
  EXEC_CB_COOLDOWN_MS: {
    description: 'How long the circuit stays open before probing again.',
    example: '30000'
  },
  EXEC_CB_HALF_OPEN_MAX_SUCCESSES: {
    description: 'Successful probes required to fully close a half-open circuit.',
    example: '2'
  },
  EXEC_RECON_ACK_TIMEOUT_MS: {
    description: 'Time to wait for ack events before flagging an order as stale.',
    example: '2000'
  },
  EXEC_RECON_FILL_TIMEOUT_MS: {
    description: 'Time to wait for fills after an ack before considering the order stale.',
    example: '10000'
  },
  EXEC_RECON_POLL_INTERVAL_MS: {
    description: 'Polling cadence for the intent reconciliation worker.',
    example: '1000'
  },
  CONTROL_PLANE_TOKEN: {
    description: 'Bearer token required for control-plane routes (unset = unauthenticated).'
  },
  CONTROL_PLANE_RATE_WINDOW_MS: {
    description: 'Sliding window (ms) for rate limiting control-plane calls.',
    example: '1000'
  },
  CONTROL_PLANE_RATE_MAX: {
    description: 'Maximum requests allowed per rate-limit window.',
    example: '50'
  },
  DASHBOARD_DIST_DIR: {
    description: 'Filesystem path to a prebuilt dashboard bundle served by the control plane.'
  },
  BALANCE_SYNC_INTERVAL_MS: {
    description: 'Interval (ms) between venue balance polls; set 0 to disable.',
    example: '60000'
  },
  BALANCE_SYNC_DRIFT_BPS: {
    description: 'Basis-point threshold for logging drift between provider and projection.',
    example: '200'
  },
  REBALANCER_TARGETS: {
    description: 'JSON array of desired per-venue holdings used by the rebalancer.',
    example: `[{"venue":"binance","asset":"USDT","min":5000}]`
  },
  REBALANCER_INTERVAL_MS: {
    description: 'Polling interval (ms) for evaluating rebalance targets.',
    example: '300000'
  },
  REBALANCER_AUTO_EXECUTE: {
    description: 'Enable the automated transfer executor (mock/demo only for now).',
    example: 'false'
  },
  REBALANCER_EXECUTOR_MODE: {
    description: 'Transfer executor provider (`manual`, `mock`, `binance`, `hyperliquid`).',
    example: 'manual'
  }
};

const README_START = '<!-- CONFIG_TABLE_START -->';
const README_END = '<!-- CONFIG_TABLE_END -->';

const describeSchema = (schema: z.ZodTypeAny): string => {
  const base = unwrap(schema);
  const typeName = base._def.typeName as z.ZodFirstPartyTypeKind | string;
  switch (typeName) {
    case z.ZodFirstPartyTypeKind.ZodString:
      return 'string';
    case z.ZodFirstPartyTypeKind.ZodNumber:
      return 'number';
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return 'boolean';
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return `enum(${base._def.values.join(', ')})`;
    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return `literal(${JSON.stringify(base._def.value)})`;
    case z.ZodFirstPartyTypeKind.ZodUnion:
      return base._def.options
        .map((option: z.ZodTypeAny) => describeSchema(option))
        .join(' | ');
    default:
      return typeName ?? 'unknown';
  }
};

const unwrap = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  if ('innerType' in schema._def && schema._def.innerType) {
    return unwrap(schema._def.innerType);
  }
  if ('schema' in schema._def && schema._def.schema) {
    return unwrap(schema._def.schema);
  }
  return schema;
};

const formatDefault = (value: unknown): string => {
  if (value === undefined) return '—';
  if (typeof value === 'string') {
    return value.length ? `\`${value}\`` : '`""`';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `\`${String(value)}\``;
  }
  return `\`${JSON.stringify(value)}\``;
};

const generateTable = () => {
  const defaults = envSchema.parse({});
  const shape = envSchema.shape as Record<string, z.ZodTypeAny>;
  const keys = Object.keys(shape);
  const missing = keys.filter((key) => !CONFIG_DOCS[key]);
  if (missing.length) {
    throw new Error(
      `Missing config documentation for: ${missing
        .map((key) => `"${key}"`)
        .join(', ')}`
    );
  }

  const header = '| Key | Type | Default | Description | Example |\n| --- | --- | --- | --- | --- |';
  const rows = keys.map((key) => {
    const type = describeSchema(shape[key]);
    const defaultValue = formatDefault((defaults as Record<string, unknown>)[key]);
    const meta = CONFIG_DOCS[key];
    const example = meta.example ? `\`${meta.example}\`` : '—';
    return `| \`${key}\` | ${type} | ${defaultValue} | ${meta.description} | ${example} |`;
  });

  return [header, ...rows].join('\n');
};

const updateReadme = (table: string) => {
  const readmePath = path.resolve(process.cwd(), 'README.md');
  const contents = fs.readFileSync(readmePath, 'utf8');
  const startIdx = contents.indexOf(README_START);
  const endIdx = contents.indexOf(README_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('README markers for config table not found.');
  }
  const before = contents.slice(0, startIdx + README_START.length);
  const after = contents.slice(endIdx);
  const next = `${before}\n${table}\n${after}`;
  fs.writeFileSync(readmePath, next);
};

const main = () => {
  const table = generateTable();
  updateReadme(table);
  console.log(`Updated configuration table with ${Object.keys(envSchema.shape).length} entries.`);
};

main();
