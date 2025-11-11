#!/usr/bin/env bun
import { Command } from 'commander';
import { writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FeedType,
  StrategyType,
  parseFeedType,
  parseStrategyType,
} from '@rx-trader/core/constants';
import { safeParse } from '@rx-trader/core/validation';
import { marketTickSchema, accountBalanceAdjustedSchema, accountTransferSchema } from '@rx-trader/core/domain';
import { startEngine } from '@rx-trader/control-plane';
import { runBacktest, loadTicks } from '@rx-trader/backtest';
import { loadConfig, loadConfigDetails, type AppConfig } from '@rx-trader/config';
import { createEventStore, buildProjection, balancesProjection } from '@rx-trader/event-store';
import { planRebalance, flattenBalancesState } from '@rx-trader/portfolio';
import {
  createMarketStructureStore,
  MarketStructureRepository,
  syncMarketStructure,
  syncFeeSchedules,
  type FeeSyncVenue,
} from '@rx-trader/market-structure';
import { fetchBinanceMarketStructure } from '@rx-trader/market-structure/adapters/binance';
import { fetchHyperliquidMarketStructure } from '@rx-trader/market-structure/adapters/hyperliquid';
import { createScriptClock } from './lib/scriptClock';

const setupLog = (message: string) => {
  console.log(`[setup] ${message}`);
};

const ensureConfigFile = (dryRun: boolean) => {
  const target = resolve('rx.config.json');
  if (existsSync(target)) {
    setupLog(`Found existing ${target}`);
    return target;
  }
  const example = resolve('rx.config.example.json');
  if (!existsSync(example)) {
    setupLog('No rx.config.json found and rx.config.example.json is missing; skipping creation');
    return target;
  }
  setupLog(`Creating ${target} from rx.config.example.json${dryRun ? ' (dry-run)' : ''}`);
  if (!dryRun) {
    copyFileSync(example, target);
  }
  return target;
};

const supportedExchangeFetchers = {
  binance: fetchBinanceMarketStructure,
  hyperliquid: fetchHyperliquidMarketStructure,
} as const;

const syncMarketStructures = async (exchanges: string[], sqlitePath: string, dryRun: boolean) => {
  if (!exchanges.length) {
    setupLog('No exchanges requested for market:sync');
    return;
  }
  setupLog(`Syncing market structure for ${exchanges.join(', ')}${dryRun ? ' (dry-run)' : ''}`);
  if (dryRun) return;
  const store = createMarketStructureStore(sqlitePath);
  const repo = new MarketStructureRepository(store.db);
  try {
    for (const code of exchanges) {
      const fetcher = supportedExchangeFetchers[code as keyof typeof supportedExchangeFetchers];
      if (!fetcher) {
        setupLog(`Skipping unsupported exchange "${code}"`);
        continue;
      }
      const snapshot = await fetcher();
      await syncMarketStructure({ repository: repo, snapshot });
      setupLog(`Synced market structure for ${code}`);
    }
  } finally {
    store.close();
  }
};

const seedDemoEventStore = async (config: AppConfig, dryRun: boolean) => {
  setupLog(
    `Seeding demo tick into ${config.persistence.driver} store${dryRun ? ' (dry-run)' : ''}`,
  );
  if (dryRun) return;
  const store = await createEventStore(config);
  const primaryStrategy = config.strategies[0];
  const symbol = primaryStrategy?.tradeSymbol ?? 'BTCUSDT';
  const venue = primaryStrategy?.venue ?? 'paper';
  const quoteAsset = primaryStrategy?.quoteAsset ?? 'USDT';
  await store.append({
    id: crypto.randomUUID(),
    type: 'account.balance.adjusted',
    data: safeParse(accountBalanceAdjustedSchema, {
      id: crypto.randomUUID(),
      t: Date.now(),
      accountId: config.execution.account,
      venue,
      asset: quoteAsset,
      delta: 1_000,
      reason: 'deposit'
    }),
    ts: Date.now()
  });
  await store.append({
    id: crypto.randomUUID(),
    type: 'market.tick',
    data: safeParse(marketTickSchema, {
      t: Date.now(),
      symbol,
      bid: 100,
      ask: 100.1,
    }),
    ts: Date.now(),
    metadata: { source: 'setup-script', env: config.app.env },
  });
  (store as unknown as { close?: () => Promise<void> | void }).close?.();
};

const printSetupNextSteps = (gatewayPort: number) => {
  console.log('\nNext steps:');
  console.log('  1. bun run rx config print');
  console.log('  2. bun run start:dev');
  console.log(`  3. Visit http://localhost:${gatewayPort} for the control plane/API`);
  console.log('  4. bun run start:demo (optional sandbox)');
};

export const buildProgram = (): Command => {
  const program = new Command();
  program.name('rx').description('Rx-Trader CLI').version('0.1.0');

  const runBun = async (...args: string[]) => {
    let cwd: string | undefined;
    let startIndex = 0;
    if (args[0] === '--cwd') {
      cwd = args[1];
      startIndex = 2;
    }
    const proc = Bun.spawn({
      cmd: ['bun', 'run', ...args.slice(startIndex)],
      cwd,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`Command failed: bun run ${args.join(' ')}`);
    }
  };

  const forwardOutput = (stream: ReadableStream | undefined, label: string) => {
    if (!stream) return;
    const decoder = new TextDecoder();
    stream
      .pipeTo(
        new WritableStream({
          write(chunk) {
            const text = decoder.decode(chunk);
            text
              .split(/\r?\n/)
              .filter((line) => line.trim().length)
              .forEach((line) => {
                console.log(`${label} ${line}`);
              });
          }
        })
      )
      .catch(() => {});
  };

  const startDashboardDevServer = (options: { gatewayUrl: string; port: number }) => {
    const env = {
      ...process.env,
      VITE_GATEWAY_URL: options.gatewayUrl,
      VITE_GATEWAY_PROXY: options.gatewayUrl,
    };
    const proc = Bun.spawn({
      cmd: ['bun', 'run', 'dev', '--', '--port', String(options.port)],
      cwd: 'packages/dashboard',
      stdout: 'pipe',
      stderr: 'pipe',
      env
    });
    forwardOutput(proc.stdout, '[dashboard]');
    forwardOutput(proc.stderr, '[dashboard]');
    return proc;
  };

  const openBrowser = (url: string) => {
    const platform = process.platform;
    let cmd: string[] | null = null;
    if (platform === 'darwin') {
      cmd = ['open', url];
    } else if (platform === 'win32') {
      cmd = ['cmd', '/c', 'start', '', url];
    } else {
      cmd = ['xdg-open', url];
    }
    if (cmd) {
      try {
        Bun.spawn({ cmd, stdout: 'ignore', stderr: 'ignore' });
      } catch {
        // best effort
      }
    }
  };

  const runTraderProcess = async (options: {
    live: boolean;
    dashboardEnabled: boolean;
    dashboardPort: number;
    openDashboard: boolean;
  }) => {
    const config = loadConfig();
    const gatewayPort = config.gateway.port;
    const gatewayUrl = `http://localhost:${gatewayPort}`;
    let dashboardProc: ReturnType<typeof startDashboardDevServer> | null = null;
    let shuttingDown = false;

    const handle = await startEngine({
      live: options.live,
      registerSignalHandlers: false,
    });
    console.log(`Gateway API: ${gatewayUrl}`);

    if (options.dashboardEnabled) {
      dashboardProc = startDashboardDevServer({
        gatewayUrl,
        port: options.dashboardPort,
      });
      console.log(`Dashboard UI: http://localhost:${options.dashboardPort}`);
      dashboardProc.exited.then((code) => {
        if (!shuttingDown && code !== 0) {
          console.error(`Dashboard exited with code ${code}`);
        }
      });
      if (options.openDashboard) {
        setTimeout(() => openBrowser(`http://localhost:${options.dashboardPort}`), 1500);
      }
    }

    const waitForDashboard = async () => {
      if (!dashboardProc) return;
      try {
        const { exited } = dashboardProc;
        await exited;
      } catch {
        // ignore
      }
    };

    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (dashboardProc) {
        try {
          dashboardProc.kill();
        } catch {
          // ignore
        }
      }
      handle.stop();
      await waitForDashboard();
    };

    const waitForSignal = () =>
      new Promise<void>((resolve) => {
        const handleSignal = async () => {
          await shutdown();
          process.off('SIGINT', handleSignal);
          process.off('SIGTERM', handleSignal);
          resolve();
        };
        process.once('SIGINT', handleSignal);
        process.once('SIGTERM', handleSignal);
      });

    await waitForSignal();
  };

  type EventStoreDriver = 'memory' | 'postgres' | 'sqlite';

  const normalizeDriver = (
    value: string | undefined,
    fallback: EventStoreDriver,
  ): EventStoreDriver => {
    if (!value) return fallback;
    const lowered = value.toLowerCase();
    if (lowered === 'memory' || lowered === 'postgres' || lowered === 'sqlite') {
      return lowered;
    }
    throw new Error(`Unsupported event store driver "${value}"`);
  };

  const ensurePersistenceEnv = (
    driver: EventStoreDriver,
    sqlitePath?: string,
    options: { force?: boolean } = {},
  ) => {
    const force = options.force ?? false;
    if (force || !process.env.EVENT_STORE_DRIVER) {
      process.env.EVENT_STORE_DRIVER = driver;
    } else {
      process.env.EVENT_STORE_DRIVER = normalizeDriver(process.env.EVENT_STORE_DRIVER, driver);
    }
    if (process.env.EVENT_STORE_DRIVER === 'sqlite') {
      if (force || !process.env.SQLITE_PATH) {
        process.env.SQLITE_PATH = sqlitePath ?? process.env.SQLITE_PATH ?? 'rxtrader.sqlite';
      }
    }
  };

  program
    .command('gateway')
    .description('Run the control-plane HTTP server by itself')
    .action(async () => {
      await runBun('packages/control-plane/src/index.ts');
    });

  program
    .command('seed')
    .description('Seed sample events')
    .action(async () => {
      await runBun('scripts/seed.ts');
    });

  program
    .command('replay')
    .description('Replay projections from event store')
    .action(async () => {
      await runBun('scripts/replay.ts');
    });

  const formatSourceRow = (
    key: string,
    meta: { source: string; rawValue?: string },
    parsed: Record<string, unknown>,
  ) => {
    const parsedValue = parsed[key];
    return {
      key,
      source: meta.source,
      value: parsedValue ?? meta.rawValue ?? '(undefined)',
    };
  };

  program
    .command('import')
    .description('Import parquet ticks into Timescale')
    .argument('<file>', 'path to parquet file')
    .action(async (file) => {
      await runBun('scripts/import-parquet.ts', file);
    });

  program
    .command('fees:sync')
    .description('Fetch venue trading fees and store them in market-structure SQLite')
    .requiredOption('--venue <code>', 'Exchange code (binance|hyperliquid)')
    .option('--product <type>', 'Product type (SPOT|PERP)', 'SPOT')
    .option('--sqlite <file>', 'Path to market-structure SQLite DB', 'market-structure.sqlite')
    .action(async (opts) => {
      const venue = String(opts.venue).toLowerCase() as FeeSyncVenue;
      if (venue !== 'binance' && venue !== 'hyperliquid') {
        throw new Error(`Unsupported venue '${opts.venue}' for fees:sync`);
      }
      const sqlitePath = opts.sqlite ?? 'market-structure.sqlite';
      const store = createMarketStructureStore(sqlitePath);
      const repo = new MarketStructureRepository(store.db);
      try {
        const count = await syncFeeSchedules({
          repo,
          venue,
          productType: opts.product,
          timestamp: Date.now(),
          binance: {
            apiKey: process.env.BINANCE_API_KEY,
            apiSecret: process.env.BINANCE_API_SECRET
          },
          hyperliquid: {}
        });
        console.log(`[fees] upserted ${count} entries for ${venue} in ${sqlitePath}`);
      } finally {
        store.close();
      }
    });

  const configCommand = program.command('config').description('Inspect configuration');

  configCommand
    .command('print')
    .description('Print the effective configuration')
    .option('--json', 'Output JSON only')
    .action((opts: { json?: boolean }) => {
      const details = loadConfigDetails();
      if (opts.json) {
        console.log(JSON.stringify(details.config, null, 2));
        return;
      }

      const fileLabel = details.configFilePath
        ? `@ ${details.configFilePath}`
        : '(no rx.config.json found)';
      console.log(`Configuration file ${fileLabel}`);
      console.log('Effective config:');
      console.dir(details.config, { depth: null, colors: true });

      const rows = Object.entries(details.sources).map(([key, meta]) =>
        formatSourceRow(key, meta, details.env as Record<string, unknown>),
      );
      console.table(rows);
    });

  configCommand
    .command('validate')
    .description('Validate env vars / config overrides')
    .action(() => {
      try {
        const details = loadConfigDetails();
        const fileLabel = details.configFilePath ? ` (${details.configFilePath})` : '';
        console.log(`Configuration OK${fileLabel}`);
      } catch (error) {
        console.error('Configuration invalid:', (error as Error).message);
        process.exitCode = 1;
      }
    });

  program
    .command('backtest')
    .description('Replay historical ticks through the full engine pipeline')
    .requiredOption('-d, --data <file>', 'Tick dataset (JSON, CSV, or Parquet)')
    .option('-s, --symbol <symbol>', 'Symbol to trade', 'BTCUSDT')
    .option(
      '--strategy <type>',
      `Strategy type (${Object.values(StrategyType).join('|')})`,
      StrategyType.Momentum,
    )
    .option('--params <json>', 'Strategy params JSON', '{}')
    .option('--max-ticks <n>', 'Limit number of ticks to load', (value) => Number(value))
    .option('--publish <url>', 'POST artifact JSON to control-plane base URL')
    .option('--out <file>', 'Output JSON file', 'backtest-result.json')
    .action(async (opts) => {
      const { clock: scriptClock, meta: scriptClockMeta } = createScriptClock('backtest_cli');
      console.log(
        `[backtest] Clock source=${scriptClockMeta.source} start=${new Date(
          scriptClockMeta.startMs,
        ).toISOString()} env=${scriptClockMeta.env ?? 'system'}`,
      );
      const file = resolve(opts.data);
      const symbol = opts.symbol?.toUpperCase() ?? 'BTCUSDT';
      const dataset = await loadTicks(file, {
        symbol,
        limit: opts.maxTicks ? Number(opts.maxTicks) : undefined,
      });
      const params = opts.params ? JSON.parse(opts.params) : {};
      const strategyType = parseStrategyType(opts.strategy ?? StrategyType.Momentum);
      if (dataset.ticks.length === 0) {
        throw new Error(`Dataset ${file} did not return ticks for ${symbol}`);
      }
      const result = await runBacktest({
        ticks: dataset.ticks,
        symbol,
        strategy: {
          type: strategyType,
          params,
        },
      });

      const stats = result.stats;
      const summary = {
        symbol,
        dataset: dataset.metadata,
        ticksUsed: dataset.ticks.length,
        events: result.events.length,
        nav: result.pnl.latest?.nav ?? 0,
        realized: result.pnl.latest?.realized ?? 0,
        unrealized: result.pnl.latest?.unrealized ?? 0,
        maxDrawdown: stats.nav.maxDrawdown,
        maxDrawdownPct: stats.nav.maxDrawdownPct,
        sharpe: stats.nav.sharpe,
        runtimeMs: stats.wallRuntimeMs,
        ticksPerSecond: stats.ticksPerSecond,
      };

      const artifact = {
        summary,
        clock: {
          engine: result.clock,
          script: {
            source: scriptClockMeta.source,
            startMs: scriptClockMeta.startMs,
            env: scriptClockMeta.env ?? null,
            capturedMs: scriptClock.now(),
          },
          dataset: {
            startMs: dataset.ticks[0]?.t ?? null,
            endMs: dataset.ticks.at(-1)?.t ?? null,
          },
        },
        navCurve: result.navCurve,
        positions: result.positions,
        pnl: result.pnl,
        events: result.events,
        stats,
      };

      writeFileSync(resolve(opts.out), JSON.stringify(artifact, null, 2));

      if (opts.publish) {
        const target = new URL('/backtest/artifacts', opts.publish);
        const response = await fetch(target, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(artifact),
        });
        if (!response.ok) {
          throw new Error(`Failed to publish artifact: ${response.status} ${response.statusText}`);
        }
      }

      console.log('Backtest complete:', summary);
      console.table([
        {
          runtimeMs: stats.wallRuntimeMs.toFixed(2),
          startupMs: stats.startupMs.toFixed(2),
          replayMs: stats.replayMs.toFixed(2),
          settleMs: stats.settleMs.toFixed(2),
          ticksPerSecond: stats.ticksPerSecond.toFixed(2),
          eventsPerSecond: stats.eventsPerSecond.toFixed(2),
          sharpe: stats.nav.sharpe.toFixed(4),
          maxDrawdown: stats.nav.maxDrawdown.toFixed(2),
        },
      ]);
      console.table([
        {
          orderNew: stats.eventCounts.orderNew,
          orderAck: stats.eventCounts.orderAck,
          orderFill: stats.eventCounts.orderFill,
          orderReject: stats.eventCounts.orderReject,
          pnlAnalytics: stats.eventCounts.pnlAnalytics,
          portfolioSnapshots: stats.eventCounts.portfolioSnapshots,
        },
      ]);
    });

  program
    .command('bench')
    .description('Run the latency benchmark harness')
    .option('--ticks <n>', 'Number of synthetic ticks', '50000')
    .option('--symbol <symbol>', 'Symbol to simulate', 'BTCUSDT')
    .option('--fast <n>', 'Fast momentum window', '3')
    .option('--slow <n>', 'Slow momentum window', '5')
    .option('--warmup <n>', 'Samples to trim as warmup', '500')
    .option('--store <driver>', 'memory|none', 'memory')
    .option('--feed-port <port>', 'Port for mock feed server', '9001')
    .option('--pace <micros>', 'Delay between payload batches (microseconds)', '0')
    .option('--strategy <name>', 'momentum|pulse', 'pulse')
    .option('--min-delta-bps <n>', 'Min delta (bps) for pulse strategy', '0')
    .option('--file <path>', 'Pre-recorded payload file (one JSON payload per line)')
    .action(async (opts) => {
      const args = [
        `--ticks=${opts.ticks}`,
        `--symbol=${opts.symbol}`,
        `--fast=${opts.fast}`,
        `--slow=${opts.slow}`,
        `--warmup=${opts.warmup}`,
        `--store=${opts.store}`,
        `--feed-port=${opts.feedPort}`,
        `--pace=${opts.pace}`,
        `--strategy=${opts.strategy}`,
        `--min-delta-bps=${opts.minDeltaBps}`,
      ];
      if (opts.file) args.push(`--file=${opts.file}`);
      await runBun('scripts/perf-benchmark.ts', ...args);
    });

  program
    .command('sentiment-demo')
    .description('Run the sentiment feed -> strategy demo')
    .action(async () => {
      await runBun('examples/sentiment-demo.ts');
    });

  program
    .command('setup')
    .description('Initialize config, sync market metadata, and seed demo data')
    .option(
      '--exchanges <codes>',
      'Comma-separated exchanges (default: binance,hyperliquid)',
      'binance,hyperliquid',
    )
    .option('--skip-seed', 'Skip demo event-store seed')
    .option('--dry-run', 'Show actions without performing them')
    .action(async (opts) => {
      const dryRun = Boolean(opts.dryRun);
      const exchanges = String(opts.exchanges ?? 'binance,hyperliquid')
        .split(',')
        .map((code) => code.trim().toLowerCase())
        .filter((code) => code.length > 0);

      const configPath = ensureConfigFile(dryRun);
      const details = loadConfigDetails();
      setupLog(`Using config file ${details.configFilePath ?? configPath}`);

      await syncMarketStructures(exchanges, details.config.persistence.sqlitePath, dryRun);

      if (opts.skipSeed) {
        setupLog('Skipping demo seed (--skip-seed provided)');
      } else {
        await seedDemoEventStore(details.config, dryRun);
      }

      setupLog('Setup complete');
      printSetupNextSteps(details.config.gateway.port);
    });

  const dataCommand = program.command('data').description('Market data & structure utilities');

  dataCommand
    .command('sync')
    .description('Fetch and persist market structure for a given exchange')
    .option('--exchange <code>', 'binance|hyperliquid', 'binance')
    .action(async (opts) => {
      const config = loadConfig();
      const exchange = String(opts.exchange ?? 'binance').toLowerCase();
      const store = createMarketStructureStore(config.marketStructure.sqlitePath);
      const repo = new MarketStructureRepository(store.db);
      try {
        let snapshot;
        if (exchange === 'binance') {
          snapshot = await fetchBinanceMarketStructure();
        } else if (exchange === 'hyperliquid') {
          snapshot = await fetchHyperliquidMarketStructure();
        } else {
          throw new Error(`Unsupported exchange "${exchange}"`);
        }
        await syncMarketStructure({ repository: repo, snapshot });
        console.log(`Synced market structure for ${exchange}`);
      } finally {
        store.close();
      }
    });

  const accountCommand = program.command('account').description('Account & inventory utilities');

  accountCommand
    .command('seed')
    .description('Append an account.balance.adjusted event (deposit/withdrawal/funding/fill)')
    .requiredOption('--amount <number>', 'Delta amount (positive = deposit, negative = withdrawal)')
    .option('--asset <symbol>', 'Asset symbol', 'USD')
    .option('--venue <venue>', 'paper|binance|hyperliquid', 'paper')
    .option('--account-id <id>', 'Account identifier (defaults to execution account)')
    .option('--reason <reason>', 'deposit|withdrawal|funding|transfer|fee|manual', 'manual')
    .option('--metadata <json>', 'Optional metadata JSON object')
    .option('--dry-run', 'Print the event without persisting')
    .action(async (opts) => {
      const config = loadConfig();
      const amount = Number(opts.amount);
      if (!Number.isFinite(amount)) {
        throw new Error('Amount must be a finite number (use negatives for withdrawals)');
      }
      const venue = String(opts.venue ?? 'paper').toLowerCase();
      if (!['paper', 'binance', 'hyperliquid'].includes(venue)) {
        throw new Error(`Unsupported venue "${opts.venue}"`);
      }
      const reason = String(opts.reason ?? 'manual').toLowerCase();
      const allowedReasons = [
        'deposit',
        'withdrawal',
        'funding',
        'transfer',
        'fee',
        'manual',
        'fill',
        'sync'
      ];
      if (!allowedReasons.includes(reason)) {
        throw new Error(`Reason must be one of: ${allowedReasons.join(', ')}`);
      }

      let metadata: Record<string, unknown> | undefined;
      if (opts.metadata) {
        try {
          metadata = JSON.parse(opts.metadata);
        } catch (error) {
          throw new Error(`Failed to parse --metadata JSON: ${(error as Error).message}`);
        }
      }

      const now = Date.now();
      const accountId = opts.accountId ?? config.execution.account ?? 'DEMO';
      const payload = safeParse(
        accountBalanceAdjustedSchema,
        {
          id: crypto.randomUUID(),
          t: now,
          accountId,
          venue,
          asset: String(opts.asset ?? 'USD').toUpperCase(),
          delta: amount,
          reason,
          metadata: metadata ?? { source: 'rx account:seed' }
        },
        { force: true }
      );

      if (opts.dryRun) {
        console.log('[account] dry-run event', payload);
        return;
      }

      const store = await createEventStore(config);
      try {
        await store.append({
          id: crypto.randomUUID(),
          type: 'account.balance.adjusted',
          data: payload,
          ts: payload.t
        });
        console.log(
          `Appended account.balance.adjusted for ${accountId} (${venue} ${payload.asset} ${payload.delta})`
        );
      } finally {
        (store as unknown as { close?: () => Promise<void> | void }).close?.();
      }
    });

  accountCommand
    .command('rebalance')
    .description('Preview rebalance transfers based on configured targets')
    .option('--json', 'Output JSON only')
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.rebalancer.targets.length) {
        console.log('No rebalancer targets configured (REBALANCER_TARGETS is empty).');
        return;
      }
      const store = await createEventStore(config);
      try {
        const state = await buildProjection(store, balancesProjection);
        const balances = flattenBalancesState(state.balances ?? {});
        const plan = planRebalance(balances, config.rebalancer.targets);
        if (opts.json) {
          console.log(JSON.stringify(plan, null, 2));
          return;
        }
        if (!plan.transfers.length) {
          console.log('No rebalance transfers required.');
        } else {
          console.log('Suggested transfers:');
          plan.transfers.forEach((transfer) => {
            console.log(
              `  ${transfer.amount} ${transfer.from.asset} from ${transfer.from.venue} -> ${transfer.to.venue} (${transfer.reason})`
            );
          });
        }
        if (plan.deficits.length) {
          console.log('\nUnresolved deficits:');
          plan.deficits.forEach((def) =>
            console.log(`  ${def.venue} ${def.asset} shortfall ${def.shortfall} (${def.reason})`)
          );
        }
      } finally {
        (store as unknown as { close?: () => Promise<void> | void }).close?.();
      }
    });

  accountCommand
    .command('transfer')
    .description('Record a completed transfer between venues (updates balances)')
    .requiredOption('--from-venue <venue>', 'Source venue')
    .requiredOption('--to-venue <venue>', 'Destination venue')
    .requiredOption('--asset <symbol>', 'Asset symbol')
    .requiredOption('--amount <number>', 'Amount to transfer')
    .option('--account-id <id>', 'Account identifier (defaults to execution account)')
    .option('--request-id <uuid>', 'Optional ID of the original transfer request')
    .action(async (opts) => {
      const config = loadConfig();
      const accountId = opts.accountId ?? config.execution.account ?? 'DEMO';
      const amount = Number(opts.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Amount must be a positive number');
      }
      const fromVenue = String(opts.fromVenue);
      const toVenue = String(opts.toVenue);
      const asset = String(opts.asset).toUpperCase();
      const now = Date.now();
      const requestId = opts.requestId ? String(opts.requestId) : crypto.randomUUID();
      const transferPayload = safeParse(
        accountTransferSchema,
        {
          id: requestId,
          t: now,
          accountId,
          fromVenue,
          toVenue,
          asset,
          amount
        },
        { force: true }
      );
      const debits = safeParse(
        accountBalanceAdjustedSchema,
        {
          id: crypto.randomUUID(),
          t: now,
          accountId,
          venue: fromVenue,
          asset,
          delta: -amount,
          reason: 'transfer'
        },
        { force: true }
      );
      const credits = safeParse(
        accountBalanceAdjustedSchema,
        {
          id: crypto.randomUUID(),
          t: now,
          accountId,
          venue: toVenue,
          asset,
          delta: amount,
          reason: 'transfer'
        },
        { force: true }
      );

      const store = await createEventStore(config);
      try {
        await store.append([
          {
          id: crypto.randomUUID(),
          type: 'account.transfer',
          data: transferPayload,
          ts: now,
          metadata: opts.requestId ? { requestId: opts.requestId } : undefined
        },
        {
          id: crypto.randomUUID(),
          type: 'account.balance.adjusted',
          data: opts.requestId ? { ...debits, metadata: { requestId: opts.requestId } } : debits,
          ts: now
        },
        {
          id: crypto.randomUUID(),
          type: 'account.balance.adjusted',
          data: opts.requestId ? { ...credits, metadata: { requestId: opts.requestId } } : credits,
          ts: now
        }
        ]);
        console.log(
          `Recorded transfer of ${amount} ${asset} from ${fromVenue} to ${toVenue} for ${accountId}`
        );
      } finally {
        (store as unknown as { close?: () => Promise<void> | void }).close?.();
      }
    });

  program
    .command('run')
    .alias('start')
    .description('Start the unified trader (default dry-run)')
    .option('--live', 'Submit orders via live adapter when credentials exist', false)
    .option('--dashboard', 'Launch dashboard alongside trader')
    .option('--no-dashboard', 'Disable dashboard launch')
    .option('--dashboard-port <port>', 'Dashboard dev server port', '5173')
    .option('--open-dashboard', 'Automatically open the dashboard URL in your browser')
    .action(async (opts) => {
      const envPref = process.env.RX_RUN_DASHBOARD;
      const defaultDashboard = envPref ? envPref !== '0' : true;
      const dashboardEnabled =
        typeof opts.dashboard === 'boolean' ? opts.dashboard : defaultDashboard;
      const dashboardPort = Number(opts.dashboardPort ?? process.env.RX_DASHBOARD_PORT ?? 5173);
      const openDashboard = Boolean(opts.openDashboard ?? process.env.RX_OPEN_DASHBOARD === '1');

      try {
        await runTraderProcess({
          live: opts.live,
          dashboardEnabled,
          dashboardPort,
          openDashboard: openDashboard && dashboardEnabled,
        });
      } catch (error) {
        console.error('Failed to start trader', error);
        process.exit(1);
      }
    });

  program
    .command('dashboard')
    .description('Launch the dashboard (Vite dev server)')
    .option('--port <port>', 'Dashboard dev server port', '5173')
    .option('--gateway <url>', 'Gateway base URL', 'http://localhost:8080')
    .action(async (opts) => {
      const port = Number(opts.port ?? 5173);
      const proc = startDashboardDevServer({ gatewayUrl: opts.gateway, port });
      console.log(`Dashboard UI: http://localhost:${port}`);
      await proc.exited;
    });

  program
    .command('env:test')
    .description('Seed the event store with sample orders, fills, and portfolio snapshot data')
    .option('--driver <driver>', 'Event store driver (memory|sqlite|postgres)', 'sqlite')
    .option('--sqlite <file>', 'Path to SQLite DB file', 'rxtrader.sqlite')
    .action(async (opts) => {
      const driver = normalizeDriver(opts.driver, 'sqlite');
      ensurePersistenceEnv(driver, opts.sqlite, { force: true });
      await runBun('scripts/bootstrap-test-env.ts');
    });

  program
    .command('env:demo')
    .alias('demo')
    .description('Seed sample data, launch trader, and start dashboard dev server')
    .option('--live', 'Submit orders via live adapter when credentials exist', false)
    .option('--driver <driver>', 'Event store driver (memory|sqlite|postgres)', 'sqlite')
    .option('--sqlite <file>', 'Path to SQLite DB file', 'rxtrader.sqlite')
    .option('--symbol <symbol>', 'Trading symbol to subscribe to', 'BTCUSDT')
    .option(
      '--feed <feed>',
      `Feed adapter to use (${Object.values(FeedType).join('|')})`,
      FeedType.Binance,
    )
    .option('--dashboard', 'Launch dashboard dev server (default on)')
    .option('--no-dashboard', 'Disable dashboard launch')
    .option('--dashboard-port <port>', 'Dashboard dev server port', '5173')
    .option('--open-dashboard', 'Automatically open the dashboard URL in your browser')
    .action(async (opts) => {
      const driver = normalizeDriver(opts.driver, 'sqlite');
      ensurePersistenceEnv(driver, opts.sqlite, { force: true });
      const selectedFeed = parseFeedType(opts.feed ?? FeedType.Binance);
      const tradeSymbol = opts.symbol?.toUpperCase() ?? 'BTCUSDT';
      process.env.STRATEGY_TRADE_SYMBOL = tradeSymbol;
      process.env.STRATEGY_PRIMARY_FEED = selectedFeed;
      process.env.STRATEGY_EXTRA_FEEDS = '';
      if (!process.env.STRATEGY_TYPE) {
        process.env.STRATEGY_TYPE = StrategyType.Momentum;
      }
      if (!process.env.STRATEGY_PARAMS) {
        process.env.STRATEGY_PARAMS = JSON.stringify({
          symbol: tradeSymbol,
          fastWindow: 5,
          slowWindow: 20,
        });
      }
      process.env.RISK_NOTIONAL_LIMIT = process.env.RISK_NOTIONAL_LIMIT ?? '1000000';
      process.env.RISK_MAX_POSITION = process.env.RISK_MAX_POSITION ?? '100';
      process.env.RISK_PRICE_BAND_MIN = process.env.RISK_PRICE_BAND_MIN ?? '0';
      process.env.RISK_PRICE_BAND_MAX =
        process.env.RISK_PRICE_BAND_MAX ?? String(Number.MAX_SAFE_INTEGER);
      process.env.RISK_THROTTLE_WINDOW_MS = process.env.RISK_THROTTLE_WINDOW_MS ?? '5000';
      process.env.RISK_THROTTLE_MAX_COUNT = process.env.RISK_THROTTLE_MAX_COUNT ?? '1';
      if (!process.env.INTENT_MODE) {
        process.env.INTENT_MODE = 'makerPreferred';
      }
      if (!process.env.INTENT_LIMIT_OFFSET_BPS) {
        process.env.INTENT_LIMIT_OFFSET_BPS = '3';
      }
      if (!process.env.INTENT_MIN_EDGE_BPS) {
        process.env.INTENT_MIN_EDGE_BPS = '0';
      }
      if (!process.env.INTENT_DEFAULT_QTY) {
        process.env.INTENT_DEFAULT_QTY = selectedFeed === FeedType.Binance ? '0.001' : '1';
      }

      if (!process.env.STRATEGIES) {
        const demoStrategies = [
          {
            id: 'momentum-main',
            type: StrategyType.Momentum,
            tradeSymbol,
            primaryFeed: selectedFeed,
            extraFeeds: [],
            mode: 'live',
            priority: 10,
            params: {
              fastWindow: 5,
              slowWindow: 20,
              minConsensus: 1,
              maxSignalAgeMs: 2_000,
              minActionIntervalMs: 1_000,
            },
            budget: {
              notional: 250_000,
              maxPosition: 2,
              throttle: { windowMs: 1_000, maxCount: 2 },
            },
          },
          {
            id: 'arb-binance-hl',
            type: StrategyType.Arbitrage,
            tradeSymbol,
            primaryFeed: FeedType.Binance,
            extraFeeds: [FeedType.Hyperliquid],
            mode: 'live',
            priority: 6,
            params: {
              primaryVenue: FeedType.Binance,
              secondaryVenue: FeedType.Hyperliquid,
              spreadBps: 3,
              maxAgeMs: 3_000,
              minIntervalMs: 200,
              priceSource: 'mid',
              maxSkewBps: 15,
              sizeBps: 25,
              minEdgeBps: 1,
            },
            budget: {
              notional: 150_000,
              maxPosition: 2,
              throttle: { windowMs: 500, maxCount: 4 },
            },
          },
        ];
        process.env.STRATEGIES = JSON.stringify(demoStrategies);
      }

      const envPref = process.env.RX_RUN_DASHBOARD;
      const defaultDashboard = envPref ? envPref !== '0' : true;
      const dashboardEnabled =
        typeof opts.dashboard === 'boolean' ? opts.dashboard : defaultDashboard;
      const dashboardPort = Number(opts.dashboardPort ?? process.env.RX_DASHBOARD_PORT ?? 5173);
      const openDashboard = Boolean(opts.openDashboard ?? process.env.RX_OPEN_DASHBOARD === '1');

      await runTraderProcess({
        live: opts.live,
        dashboardEnabled,
        dashboardPort,
        openDashboard: openDashboard && dashboardEnabled,
      });
    });

  return program;
};

if (import.meta.main) {
  const program = buildProgram();
  void program.parseAsync(process.argv);
}
