# rx-trader

Reactive, event‑sourced crypto trading system in Bun + TypeScript. One process ingests live ticks, builds signals, shapes intents through risk and execution policy, persists every event, and serves a control‑plane API plus a live dashboard. The same runtime powers deterministic backtests by swapping dependencies (feeds, execution, clocks, persistence).

--

## Core Philosophy
- Event‑first: every tick, signal, intent, fill, snapshot, and analytic is an immutable event. Projections and dashboards are pure replays over the same facts.
- Reactive by design: RxJS wires feeds → strategies → intent builder → risk → execution. Business logic stays pure; side effects live at the edges.
- Config‑first: the same binary runs demos, backtests, and live trading. Behavior is driven by `rx.config.json` and env vars.
- Single runtime: no microservice sprawl. A persistence worker offloads DB writes without touching the hot path.

--

## Architecture
```mermaid
graph LR
  subgraph Feeds
    BF[Binance WS]
    HF[Hyperliquid WS]
    SF[Sentiment]
  end
  subgraph Pipeline
    FM(Feed Manager)
    STRAT(Strategies)
    EXIT(Exit Engine)
    INTENT(Intent Builder)
    RISK(Risk Filters)
    EXEC(Execution Manager)
  end
  subgraph Persistence
    QUEUE(Shared Queue)
    WORKER(Worker)
    STORE(Event Store)
    PROJ(Projections)
  end
  subgraph Ops
    API(Control Plane)
    UI(React Dashboard)
  end
  BF & HF & SF --> FM --> STRAT --> INTENT --> RISK --> EXEC
  PROJ --> EXIT --> RISK
  EXEC --> API
  INTENT --> QUEUE --> WORKER --> STORE --> PROJ --> API --> UI
```

--

## Packages
- `packages/core` – Domain schemas (Zod) and constants for ticks, orders, events, portfolio, time.
- `packages/feeds` – Live WebSocket adapters (Binance, Hyperliquid) and a sentiment/demo feed.
- `packages/strategies` – Strategy registry and DSL (rolling windows, z‑scores, crossovers, cooldown/dedupe helpers, intent builder).
- `packages/risk` – Pre‑trade and post‑trade risk modules.
- `packages/execution` – Paper adapter plus REST gateways (Binance, Hyperliquid) with retries and circuit breakers.
- `packages/event-store` – Memory/SQLite stores, projections (positions, PnL), snapshot/replay, shared‑memory queue + worker.
- `packages/portfolio` – Positions/PnL analytics, balance sync providers, and the automated rebalancer service.
- `packages/pipeline` – Feed manager, strategy orchestrator, execution policy/manager, intent reconciliation, feed health metrics.
- `packages/control-plane` – Composition entrypoint (`startEngine`) + Bun HTTP/SSE API (status, positions, PnL, orders, artifacts, logs, metrics).
- `packages/dashboard` – Vite + React + shadcn/ui dashboard (dev server for local; can be served by the control plane in prod).

--

## Quickstart (5–10 minutes)

- Prereqs: Bun ≥ 1.3, Node ≥ 20, SQLite.

1) Install deps and the CLI shim
```
bun install
bun run link:rx   # installs an 'rx' shim into ~/.bun/bin
```

2) Guided setup
```
rx setup          # copies rx.config.json (if missing), syncs market-structure, seeds a demo tick
rx config print   # show effective config + source of each value
rx market:sync    # re-sync Binance + Hyperliquid exchange info into SQLite (idempotent)
```

3) Start (paper mode) with the dashboard
```
rx run --dashboard
# Control plane: http://localhost:8080
# Dashboard (dev): http://localhost:5173
```

4) Go live (optional)
```
BINANCE_API_KEY=... BINANCE_API_SECRET=... \
HYPERLIQUID_API_KEY=... HYPERLIQUID_API_SECRET=... \
rx run --live --dashboard
```
If a venue lacks credentials, a mock adapter is used for that venue while everything else stays live.

### Demo (multi-strategy)
`rx env:demo --dashboard` seeds SQLite, hydrates `STRATEGIES` with the BTC momentum + Binance/Hyperliquid arbitrage pair, bootstraps the trader, launches the dashboard dev server, and wires the mock balance provider. The new **Strategy Mixer** in the dashboard lets you switch between strategies (or view “All”), filter positions/orders, and watch aggregated signals/intents/orders/fills/rejects plus last-activity timestamps per strategy.

--

## Backtests and Benchmarks
- Backtest over CSV/Parquet/JSON (auto‑detected via DuckDB) and publish artifacts:
```
rx backtest --data BTCUSDT-1m-2025-10.csv --symbol BTCUSDT --publish http://localhost:8080
```
- Inspect datasets quickly:
```
bun run scripts/inspectTicks.ts BTCUSDT-1m-2025-10.csv
```
- Benchmark the pipeline:
```
rx bench --ticks 100000 --symbol BTCUSDT --store sqlite --sqlite bench.sqlite
```

--

## Configuration
Three layers (later overrides earlier):
1. `rx.config.json` (or `RX_CONFIG_PATH`)
2. Environment variables (`.env` is loaded automatically)
3. Inline overrides (`KEY=value rx run ...`)

Example `rx.config.json`:
```json
{
  "strategy_type": "PAIR",
  "strategy_trade_symbol": "BTCUSDT",
  "strategy_primary_feed": "BINANCE",
  "risk_max_position": 1,
  "risk_notional_limit": 1000000,
  "intent_mode": "market",
  "sqlite_path": "rxtrader.sqlite",
  "market_structure_sqlite_path": "market-structure.sqlite",
  "rebalancer_targets": [
    { "venue": "binance", "asset": "USDT", "min": 100 }
  ]
}
```
Print the effective configuration:
```
rx config print --json
```

### Multiple strategies
Set the `strategies` array (or `STRATEGIES` env var containing JSON) to register multiple strategy definitions with priorities, sandbox mode, and optional per-strategy budgets.

```json
{
  "strategies": [
    {
      "id": "btc-momo",
      "type": "MOMENTUM",
      "tradeSymbol": "BTCUSDT",
      "primaryFeed": "BINANCE",
      "params": { "fastWindow": 5, "slowWindow": 20 },
      "priority": 10,
      "mode": "live",
      "budget": {
        "notional": 250000,
        "maxPosition": 2,
        "throttle": { "windowMs": 1000, "maxCount": 2 }
      }
    },
    {
      "id": "eth-btc-pair",
      "type": "PAIR",
      "tradeSymbol": "ETHUSDT",
      "primaryFeed": "BINANCE",
      "extraFeeds": ["HYPERLIQUID"],
      "mode": "sandbox",
      "priority": 5
    }
  ]
}
```
Any missing budget fields inherit the global `risk_*` limits, and sandboxed strategies emit signals/metrics without submitting intents.

Each strategy publishes telemetry (signals, intents, orders, fills, rejects, last-activity timestamps) that surfaces via `GET /status` (`runtime.strategies[]`) and powers the dashboard Strategy Mixer + CLI/ops tooling.

> ℹ️ **Legacy env knobs:** the `STRATEGY_*` environment variables still exist, but they now only define the fallback entry in `config.strategies` when `STRATEGIES` is empty. Put real configurations in the `STRATEGIES` array (JSON string or `rx.config.json`) so everything—CLI, runtime, dashboard—reads from a single list.

### Strategy exit rules
Give every strategy an `exit` block to describe when positions should be flattened. The schema supports TP/SL bands (in sigma units), fair-value epsilon checks, time stops, trailing stops, and portfolio overrides (gross/symbol exposure, drawdown, margin buffers). Runtime config validation lives in `exitConfigSchema`, so missing/invalid fields fail fast, and defaults (`tpSigma=1.5`, `slSigma=1`, `epsilonBps=5`, etc.) are injected automatically.

```json
"exit": {
  "enabled": true,
  "tpSl": { "enabled": true, "tpSigma": 1.8, "slSigma": 0.9 },
  "fairValue": { "enabled": true, "epsilonBps": 6, "closeOnSignalFlip": true },
  "time": { "enabled": true, "maxHoldMs": 600000, "minHoldMs": 15000 },
  "trailing": { "enabled": true, "retracePct": 0.05, "initArmPnLs": 0.5 },
  "riskOverrides": {
    "maxGrossExposureUsd": 750000,
    "maxSymbolExposureUsd": 250000,
    "maxDrawdownPct": 0.04,
    "marginBufferPct": 0.15,
    "action": "FLATTEN_ALL"
  }
}
```

Exit intents merge back into the same risk/execution pipeline as normal intents, so throttle/price-band/notional guards still apply. Telemetry now tracks exit counts per reason (`EXIT_TP`, `EXIT_TIME`, etc.) and surfaces them via `/status` and the dashboard strategy cards.

### Venue fee sync
- `rx fees:sync --venue binance --product SPOT` pulls the latest maker/taker bps from Binance (requires API key/secret) and stores them in `market-structure.sqlite`.
- `rx fees:sync --venue hyperliquid --product PERP` captures Hyperliquid fees (uses public metadata).  
At runtime the execution policy automatically uses the stored fees per venue/symbol and falls back to the `INTENT_*` defaults when no entry exists.
- Pre-trade risk budgets/account guards now incorporate those maker/taker fees (and reference prices from intent metadata) before approving orders, execution adapters annotate fills with the computed fee + liquidity, and the dashboard Strategy cards display the active tier/source so operators can confirm which schedule is live.

--

## Control‑Plane API (selected)
- `GET /status` – runtime status (live/paper, kill switch, feed health, PnL summary, **`runtime.strategies[]` telemetry for every configured strategy**)
- `GET /positions`, `GET /pnl` – projections
- `POST /orders` – enqueue a paper order; `POST /orders/:venue` – submit to a specific venue
- `GET /events` / `GET /logs` – SSE streams for events and logs
- `POST /backtest/artifacts` / `GET /backtest/artifacts/history` – publish and browse backtest results

--

## Develop & Test
```
bun x tsc --noEmit           # typecheck
bun x eslint .               # lint
bun test                     # unit + integration suites
RUN_REAL_FEED_TESTS=true bun test packages/feeds/src/binance.real.test.ts
bun x knip --no-config-hints # dead-code analysis (dashboard allowlisted)
```

--

## Extend
- New feed: implement a `WebSocketFeed` adapter and register in the enum; add a real‑WS test.
- New strategy: add an observable from ticks to `StrategySignal`, export in the registry; wire intent builder params via config.
- New risk: extend `packages/risk` pre/post trade modules and their tests.
- New venue: implement `ExecutionAdapter` with retries/circuit breakers; wire in the control plane.
- New store: implement the `EventStore` interface and add it to the factory + projections’ tests.

--

## Notes
- Dashboard fetch errors (CORS): ensure the `GATEWAY_PORT` matches the control‑plane log; dev uses permissive CORS.
- SQLite “database is locked”: the persistence worker backs off; increase `PERSIST_QUEUE_CAPACITY` or adjust busy timeout if needed.
- Without creds: venues default to mock execution while still using real feeds.
- `rx env:demo --dashboard` is the fastest path to see multi-strategy orchestration end-to-end (paper trading + dashboard Strategy Mixer); stop everything with `Ctrl+C`.
