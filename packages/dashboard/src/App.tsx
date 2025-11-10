import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Circle,
  Link2,
  Signal,
  Zap,
} from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SidebarInset, SidebarProvider, SidebarRail } from '@/components/ui/sidebar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { useEventStream, usePolling, type StreamStatus } from './hooks';
import { cn } from '@/lib/utils';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

interface PnlResponse {
  nav: number;
  realized: number;
  unrealized: number;
}

interface PositionsResponse {
  [symbol: string]: { pos: number; avgPx: number; px: number; pnl: number };
}

interface LogEntry {
  id: string;
  t: number;
  level: string;
  name: string;
  msg: string;
  data?: Record<string, unknown>;
}

interface BacktestSummary {
  symbol: string;
  ticksUsed: number;
  events: number;
  sharpe: number;
  maxDrawdownPct: number;
  runtimeMs: number;
}

interface BacktestArtifact {
  summary: BacktestSummary;
  navCurve: Array<{ t: number; nav: number }>;
}

interface BacktestHistoryEntry {
  id: string;
  ts: number;
  summary: BacktestSummary | null;
}

interface FeedHealthSnapshot {
  id: string;
  status: 'connecting' | 'connected' | 'disconnected';
  reconnects: number;
  lastTickTs: number | null;
  ageSeconds: number | null;
}

interface BalanceEntry {
  venue: string;
  asset: string;
  available: number;
  locked: number;
  total: number;
  lastUpdated: number;
}

interface AccountBalancesResponse {
  balances: Record<string, Record<string, BalanceEntry>>;
  updated: number | null;
}

interface MarginSummary {
  venue: string;
  equity: number;
  marginUsed: number;
  maintenance: number;
  leverageCap?: number;
  collateralAsset: string;
}

interface AccountMarginResponse {
  summaries: Record<string, MarginSummary>;
  updated: number | null;
}

interface BalanceSyncTelemetry {
  venue: string;
  provider: string;
  lastRunMs: number | null;
  lastSuccessMs: number | null;
  lastError?: { message: string; ts: number } | null;
}

interface StatusResponse {
  timestamp: number;
  app: { env: string; name: string; version: string };
  gateway: { port: number };
  runtime: {
    live: boolean;
    killSwitch: boolean;
    strategy: {
      type: string;
      tradeSymbol: string;
      primaryFeed: string;
      extraFeeds: string[];
      params: Record<string, unknown>;
    };
  };
  persistence: {
    driver: string;
    sqlitePath?: string;
  };
  feeds: FeedHealthSnapshot[];
  metrics: {
    nav: number | null;
    realized: number | null;
    unrealized: number | null;
    eventSubscribers: number;
    logSubscribers: number;
    lastEventTs: number | null;
    lastLogTs: number | null;
  };
  accounting?: {
    balanceSync?: BalanceSyncTelemetry | null;
  };
}

interface EventMessage {
  id: string;
  type: string;
  ts: number;
  data?: Record<string, unknown>;
}

interface OrderEvent {
  id: string;
  type: string;
  ts: number;
  data?: Record<string, unknown>;
}

const SummaryTile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Card>
    <CardHeader className="pb-2">
      <CardDescription className="uppercase tracking-[0.3em] text-xs text-muted-foreground">
        {label}
      </CardDescription>
      <CardTitle className="text-3xl font-semibold text-foreground">{value}</CardTitle>
    </CardHeader>
    {hint ? <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent> : null}
  </Card>
);

const Sparkline = ({ values, className }: { values: number[]; className?: string }) => {
  if (!values.length)
    return <div className={cn('h-24 w-full rounded-lg bg-muted/60', className)} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values
    .map((value, idx) => {
      const x = (idx / Math.max(values.length - 1, 1)) * 100;
      const y = max === min ? 50 : ((value - min) / (max - min)) * 100;
      return `${x},${100 - y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={cn('h-32 w-full', className)}>
      <polyline
        fill="none"
        stroke="url(#sparklineGradientLive)"
        strokeWidth="3"
        points={points}
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id="sparklineGradientLive" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
    </svg>
  );
};

const formatNumber = (value: number | undefined | null, precision = 2) =>
  Number.isFinite(value ?? NaN) ? (value as number).toFixed(precision) : '—';

const formatPercent = (value: number | undefined | null, precision = 2) =>
  Number.isFinite(value ?? NaN) ? `${((value as number) * 100).toFixed(precision)}%` : '—';

const formatAgo = (ts: number | null | undefined) => {
  if (!ts) return '—';
  const delta = Date.now() - ts;
  if (delta < 1_000) return 'just now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
};

const StatusBadge = ({ label, intent }: { label: string; intent?: 'ok' | 'warn' | 'error' }) => {
  const variants = {
    ok: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    error: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  } as const;
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-xs font-medium',
        variants[intent ?? 'ok'],
      )}
    >
      {label}
    </span>
  );
};

const ConnectionDot = ({ status }: { status: StreamStatus }) => {
  const color =
    status === 'open'
      ? 'text-emerald-400'
      : status === 'connecting'
        ? 'text-amber-400'
        : 'text-rose-400';
  return <Circle className={cn('h-3 w-3', color)} fill="currentColor" />;
};

interface SeriesPoint {
  t: number;
  value: number;
}

const downsampleSeries = (points: SeriesPoint[], maxPoints = 400) => {
  if (points.length <= maxPoints) return points;
  const bucketSize = Math.ceil(points.length / maxPoints);
  const result: SeriesPoint[] = [];
  for (let i = 0; i < points.length; i += bucketSize) {
    const slice = points.slice(i, i + bucketSize);
    if (!slice.length) continue;
    const avgValue = slice.reduce((sum, point) => sum + point.value, 0) / slice.length;
    const midpoint = slice[Math.floor(slice.length / 2)] ?? slice[0];
    result.push({ t: midpoint.t, value: avgValue });
  }
  return result;
};

const PnlChart = ({ points }: { points: SeriesPoint[] }) => {
  const options = useMemo(() => {
    const data = downsampleSeries(points).map((point) => [point.t, point.value]);
    return {
      chart: {
        backgroundColor: 'transparent',
        height: 300,
        zoomType: 'x',
      },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        type: 'datetime',
        labels: { style: { color: '#fff' } },
      },
      yAxis: {
        title: { text: 'PnL', style: { color: '#fff' } },

        gridLineColor: 'rgba(255,255,255,0.05)',
        plotLines: [{ value: 0, color: 'rgba(255,255,255,0.2)', width: 1 }],

        labels: { style: { color: '#fff' } },
      },
      tooltip: {
        xDateFormat: '%Y-%m-%d %H:%M:%S',
        valueDecimals: 2,
        backgroundColor: 'rgba(15,23,42,0.9)',
        style: { color: '#f8fafc' },
      },
      legend: { enabled: false },
      series: [
        {
          type: 'areaspline' as const,
          data,
          color: '#22c55e',
          negativeColor: '#f87171',
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 300 },
            stops: [
              [0, 'rgba(34, 197, 94, 0.25)'],
              [1, 'rgba(34, 197, 94, 0)'],
            ],
          },
          lineWidth: 2,
          marker: { radius: 0 },
          threshold: 0,
        },
      ],
    } as Highcharts.Options;
  }, [points]);

  if (!points.length) {
    return <div className="h-32 rounded-lg border border-dashed border-border/50" />;
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />;
};

export const App = () => {
  const { events: rawEvents, status: eventStreamStatus } = useEventStream<EventMessage>('/events');
  const { events: rawLogs, status: logStreamStatus } = useEventStream<LogEntry>('/logs');
  const { data: pnl } = usePolling<PnlResponse>('/pnl', 4_000);
  const { data: positions } = usePolling<PositionsResponse>('/positions', 6_000);
  const { data: publishedArtifact } = usePolling<BacktestArtifact | null>(
    '/backtest/artifacts',
    5_000,
  );
  const { data: artifactHistory } = usePolling<BacktestHistoryEntry[]>(
    '/backtest/artifacts/history?limit=12',
    8_000,
  );
  const { data: statusData } = usePolling<StatusResponse>('/status', 5_000);
  const { data: recentOrders } = usePolling<OrderEvent[]>('/orders/recent?limit=12', 5_000);
  const { data: accountBalances } = usePolling<AccountBalancesResponse>(
    '/account/balances',
    10_000,
  );
  const { data: accountMargin } = usePolling<AccountMarginResponse>('/account/margin', 12_000);

  const [gatewayUrl, setGatewayUrl] = useState(
    import.meta.env.VITE_GATEWAY_URL ?? window.location.origin,
  );
  const [backtestUrl, setBacktestUrl] = useState('');
  const [backtest, setBacktest] = useState<BacktestArtifact | null>(null);
  const [pnlHistory, setPnlHistory] = useState<SeriesPoint[]>([]);

  useEffect(() => {
    if (publishedArtifact) {
      setBacktest(publishedArtifact);
    }
  }, [publishedArtifact?.summary?.symbol, publishedArtifact?.summary?.runtimeMs]);

  useEffect(() => {
    if (pnl?.unrealized != null || pnl?.realized != null || (pnl as any)?.pnl != null) {
      const totalPnl = (pnl as any)?.pnl ?? (pnl?.realized ?? 0) + (pnl?.unrealized ?? 0);
      setPnlHistory((prev) => {
        const next = [...prev, { t: Date.now(), value: totalPnl }];
        return next.slice(-1200);
      });
    }
  }, [pnl?.realized, pnl?.unrealized, (pnl as any)?.pnl]);

  const positionEntries = Object.entries(positions ?? {});
  const history = artifactHistory ?? [];
  const feedHealth = statusData?.feeds ?? [];
  const orders = recentOrders ?? [];
  const balanceSync = statusData?.accounting?.balanceSync ?? null;
  const balanceRows = useMemo(() => {
    if (!accountBalances?.balances) return [] as Array<BalanceEntry & { venue: string }>;
    return Object.entries(accountBalances.balances)
      .flatMap(([venue, assets]) =>
        Object.values(assets ?? {}).map((entry) => ({ ...entry, venue })),
      )
      .sort((a, b) => `${a.venue}-${a.asset}`.localeCompare(`${b.venue}-${b.asset}`));
  }, [accountBalances?.balances]);

  const marginRows = useMemo(() => {
    if (!accountMargin?.summaries) return [] as MarginSummary[];
    return Object.entries(accountMargin.summaries)
      .map(([venue, summary]) => ({ ...summary, venue }))
      .sort((a, b) => a.venue.localeCompare(b.venue));
  }, [accountMargin?.summaries]);

  const recentEvents = rawEvents.slice(0, 10);
  const recentLogs = rawLogs.slice(0, 10);

  const throughput = useMemo(() => {
    const now = Date.now();
    const windowMs = 60_000;
    const counts = { ticks: 0, signals: 0, orders: 0 };
    rawEvents.forEach((evt) => {
      const ts = evt.ts ?? now;
      if (now - ts > windowMs) return;
      if (evt.type === 'market.tick') counts.ticks += 1;
      if (evt.type === 'strategy.signal') counts.signals += 1;
      if (evt.type.startsWith('order.')) counts.orders += 1;
    });
    const factor = windowMs / 1000;
    return {
      ticksPerSec: counts.ticks / factor,
      signalsPerSec: counts.signals / factor,
      ordersPerSec: counts.orders / factor,
    };
  }, [rawEvents]);

  const feedSummary = useMemo(() => {
    const total = feedHealth.length;
    const connected = feedHealth.filter((feed) => feed.status === 'connected').length;
    const stale = feedHealth.filter((feed) => (feed.ageSeconds ?? 0) > 10).length;
    return { total, connected, stale };
  }, [feedHealth]);

  const statusNav = statusData?.metrics.nav ?? pnl?.nav;
  const statusRealized = statusData?.metrics.realized ?? pnl?.realized;
  const statusUnrealized = statusData?.metrics.unrealized ?? pnl?.unrealized;

  const modeLabel = statusData?.runtime.live ? 'Live trading' : 'Paper mode';
  const modeIntent: 'ok' | 'warn' = statusData?.runtime.live ? 'ok' : 'warn';
  const killSwitchActive = statusData?.runtime.killSwitch;
  const showSseWarning = eventStreamStatus !== 'open' || logStreamStatus !== 'open';

  const openInNewTab = (path: string) => {
    const url = path.startsWith('http') ? path : `${gatewayUrl}${path}`;
    window.open(url, '_blank', 'noreferrer');
  };

  const summarizeOrder = (order: OrderEvent) => {
    const data = order.data as Record<string, unknown> | undefined;
    const meta = (data?.meta as Record<string, unknown>) ?? {};
    const symbol = (data?.symbol ?? meta.symbol ?? '—') as string;
    const side = (data?.side ?? meta.side ?? '—') as string;
    const qty = (data?.qty ?? meta.qty ?? meta.size ?? null) as number | null;
    const px = (data?.px ?? meta.execRefPx ?? meta.px ?? null) as number | null;
    return { symbol, side, qty, px };
  };

  return (
    <SidebarProvider>
      <SidebarRail />
      <SidebarInset className="bg-muted/10">
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-6 p-4 lg:p-8">
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <CardDescription>Status</CardDescription>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusBadge label={modeLabel} intent={modeIntent} />
                  <StatusBadge
                    label={`Feeds ${feedSummary.connected}/${feedSummary.total}`}
                    intent={feedSummary.connected ? 'ok' : 'warn'}
                  />
                  <span className="text-xs text-muted-foreground">
                    Last event {formatAgo(statusData?.metrics.lastEventTs)} · Last log{' '}
                    {formatAgo(statusData?.metrics.lastLogTs)}
                  </span>
                  {killSwitchActive && <StatusBadge label="Kill switch" intent="error" />}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <ConnectionDot status={eventStreamStatus} />
                  <span>Events stream</span>
                </div>
                <div className="flex items-center gap-1">
                  <ConnectionDot status={logStreamStatus} />
                  <span>Logs stream</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => openInNewTab('/')}>
                    <Link2 className="mr-1 h-3.5 w-3.5" /> Control Plane
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openInNewTab('/metrics')}>
                    <BarChart3 className="mr-1 h-3.5 w-3.5" /> Metrics
                  </Button>
                </div>
              </div>
            </CardHeader>
            {showSseWarning && (
              <CardContent className="flex items-center gap-2 text-sm text-amber-500">
                <AlertTriangle className="h-4 w-4" /> Live stream degraded — attempting to
                reconnect.
              </CardContent>
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryTile label="NAV" value={`$${formatNumber(statusNav)}`} hint="Mark-to-market" />
            <SummaryTile label="Realized" value={`$${formatNumber(statusRealized)}`} />
            <SummaryTile label="Unrealized" value={`$${formatNumber(statusUnrealized)}`} />
            <SummaryTile
              label="Events/min"
              value={(
                (throughput.ticksPerSec + throughput.signalsPerSec + throughput.ordersPerSec) *
                60
              ).toFixed(0)}
              hint="Rolling 60s window"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardDescription>Portfolio</CardDescription>
                  <CardTitle className="text-2xl font-semibold">PnL Timeline</CardTitle>
                </div>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5 text-emerald-400" />
                    <span>{formatNumber(pnlHistory.at(-1)?.value)} latest</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Signal className="h-3.5 w-3.5 text-indigo-400" />
                    <span>{pnlHistory.length} samples</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <PnlChart points={pnlHistory} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Strategy</CardDescription>
                <CardTitle className="text-xl">
                  {statusData?.runtime.strategy.type ?? '—'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Symbol</span>
                  <span className="font-semibold">
                    {statusData?.runtime.strategy.tradeSymbol ?? '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Primary Feed</span>
                  <span className="font-semibold">
                    {statusData?.runtime.strategy.primaryFeed ?? '—'}
                  </span>
                </div>
                <div>
                  <p className="text-muted-foreground">Extra Feeds</p>
                  <p className="font-semibold">
                    {statusData?.runtime.strategy.extraFeeds?.length
                      ? statusData.runtime.strategy.extraFeeds.join(', ')
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Params</p>
                  <pre className="mt-1 max-h-32 overflow-y-auto rounded-md bg-muted/40 p-2 text-xs">
                    {JSON.stringify(statusData?.runtime.strategy.params ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="text-xs text-muted-foreground">
                  Persistence: {statusData?.persistence.driver ?? '—'}
                  {statusData?.persistence.driver === 'sqlite' && statusData.persistence.sqlitePath
                    ? ` · ${statusData.persistence.sqlitePath}`
                    : ''}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardDescription>Gateway</CardDescription>
                  <CardTitle className="text-2xl">{gatewayUrl}</CardTitle>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1"
                    onClick={() => openInNewTab('/')}
                  >
                    <Link2 className="h-4 w-4" /> Open
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => openInNewTab('/metrics')}
                  >
                    <BarChart3 className="h-4 w-4" /> Metrics
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={gatewayUrl}
                  onChange={(evt) => setGatewayUrl(evt.target.value)}
                  placeholder="http://localhost:8080"
                />
                <Button
                  variant="ghost"
                  className="sm:w-48"
                  onClick={() => navigator.clipboard.writeText(gatewayUrl)}
                >
                  Copy URL
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Feed Health</CardDescription>
                <CardTitle className="text-lg">Connections</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {feedHealth.length ? (
                  feedHealth.map((feed) => (
                    <div
                      key={feed.id}
                      className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-semibold">{feed.id}</p>
                        <p className="text-xs text-muted-foreground">
                          Age {feed.ageSeconds ? `${feed.ageSeconds.toFixed(1)}s` : '—'} ·
                          Reconnects {feed.reconnects}
                        </p>
                      </div>
                      <Badge
                        variant={
                          feed.status === 'connected'
                            ? 'default'
                            : feed.status === 'connecting'
                              ? 'outline'
                              : 'destructive'
                        }
                      >
                        {feed.status}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No feed telemetry yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-col gap-2">
                <div>
                  <CardDescription>Account</CardDescription>
                  <CardTitle className="text-xl">Balances</CardTitle>
                </div>
                <div className="text-xs text-muted-foreground">
                  {balanceRows.length} holdings · Updated{' '}
                  {formatAgo(accountBalances?.updated ?? null)}
                  {balanceSync ? (
                    <span className="block text-muted-foreground/80">
                      Last sync {formatAgo(balanceSync.lastSuccessMs ?? null)} via{' '}
                      {balanceSync.provider}
                    </span>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                {balanceSync?.lastError ? (
                  <p className="mb-2 text-xs text-amber-500">
                    Balance sync error: {balanceSync.lastError.message}
                  </p>
                ) : null}
                {balanceRows.length ? (
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Venue</TableHead>
                          <TableHead>Asset</TableHead>
                          <TableHead className="text-right">Available</TableHead>
                          <TableHead className="text-right">Locked</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {balanceRows.map((row) => (
                          <TableRow key={`${row.venue}-${row.asset}`}>
                            <TableCell className="font-semibold">{row.venue}</TableCell>
                            <TableCell>{row.asset}</TableCell>
                            <TableCell className="text-right">
                              {formatNumber(row.available)}
                            </TableCell>
                            <TableCell className="text-right">{formatNumber(row.locked)}</TableCell>
                            <TableCell className="text-right">{formatNumber(row.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No balance events recorded yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-col gap-2">
                <div>
                  <CardDescription>Collateral</CardDescription>
                  <CardTitle className="text-xl">Margin Overview</CardTitle>
                </div>
                <div className="text-xs text-muted-foreground">
                  {marginRows.length} venues · Updated {formatAgo(accountMargin?.updated ?? null)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {marginRows.length ? (
                  marginRows.map((summary) => {
                    const free = summary.equity - summary.marginUsed;
                    return (
                      <div
                        key={summary.venue}
                        className="rounded-xl border border-border/50 bg-background/40 p-3"
                      >
                        <div className="flex items-center justify-between text-sm font-semibold">
                          <span>{summary.venue}</span>
                          <Badge variant="outline">{summary.collateralAsset}</Badge>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                          <div>
                            <p className="uppercase tracking-wide">Equity</p>
                            <p className="text-base font-semibold text-foreground">
                              ${formatNumber(summary.equity)}
                            </p>
                          </div>
                          <div>
                            <p className="uppercase tracking-wide">Used</p>
                            <p className="text-base font-semibold text-foreground">
                              ${formatNumber(summary.marginUsed)}
                            </p>
                          </div>
                          <div>
                            <p className="uppercase tracking-wide">Free</p>
                            <p className="text-base font-semibold text-emerald-400">
                              ${formatNumber(free)}
                            </p>
                          </div>
                          <div>
                            <p className="uppercase tracking-wide">Maintenance</p>
                            <p className="text-base font-semibold text-foreground">
                              ${formatNumber(summary.maintenance)}
                            </p>
                          </div>
                        </div>
                        {summary.leverageCap ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Leverage cap {summary.leverageCap}×
                          </p>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">No margin snapshots yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-col gap-2">
                <div>
                  <CardDescription>Positions</CardDescription>
                  <CardTitle className="text-xl">Exposure</CardTitle>
                </div>
                <div className="text-xs text-muted-foreground">
                  Updated every 6s · {positionEntries.length} symbols
                </div>
              </CardHeader>
              <CardContent>
                {positionEntries.length ? (
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Symbol</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Avg Px</TableHead>
                          <TableHead className="text-right">Last Px</TableHead>
                          <TableHead className="text-right">PnL</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {positionEntries.map(([symbol, snap]) => (
                          <TableRow key={symbol}>
                            <TableCell className="font-semibold">{symbol}</TableCell>
                            <TableCell className="text-right">
                              {formatNumber(snap.pos, 4)}
                            </TableCell>
                            <TableCell className="text-right">{formatNumber(snap.avgPx)}</TableCell>
                            <TableCell className="text-right">{formatNumber(snap.px)}</TableCell>
                            <TableCell
                              className={cn(
                                'text-right text-sm font-semibold',
                                (snap.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
                              )}
                            >
                              {formatNumber(snap.pnl)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No open positions.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-col gap-2">
                <div>
                  <CardDescription>Orders</CardDescription>
                  <CardTitle className="text-xl">Recent Activity</CardTitle>
                </div>
                <div className="text-xs text-muted-foreground">Last {orders.length} events</div>
              </CardHeader>
              <CardContent>
                {orders.length ? (
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Symbol</TableHead>
                          <TableHead className="text-right">Side</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Px</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orders.map((order) => {
                          const info = summarizeOrder(order);
                          return (
                            <TableRow key={order.id}>
                              <TableCell className="text-xs text-muted-foreground">
                                {new Date(order.ts).toLocaleTimeString()}
                              </TableCell>
                              <TableCell className="font-semibold">
                                {order.type.replace('order.', '')}
                              </TableCell>
                              <TableCell>{info.symbol}</TableCell>
                              <TableCell className="text-right">{info.side || '—'}</TableCell>
                              <TableCell className="text-right">
                                {info.qty == null ? '—' : formatNumber(info.qty, 4)}
                              </TableCell>
                              <TableCell className="text-right">
                                {info.px == null ? '—' : formatNumber(info.px, 2)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No order activity yet.</p>
                )}
              </CardContent>
            </Card>

            <Tabs defaultValue="events" className="flex flex-col lg:col-span-2">
              <TabsList className="self-end">
                <TabsTrigger value="events" className="gap-1 text-xs">
                  <Signal className="h-3 w-3" /> Events
                </TabsTrigger>
                <TabsTrigger value="logs" className="gap-1 text-xs">
                  <Activity className="h-3 w-3" /> Logs
                </TabsTrigger>
              </TabsList>
              <TabsContent value="events" className="mt-4 flex-1">
                <Card className="h-full">
                  <CardHeader>
                    <CardDescription>Most recent orchestrator events</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 space-y-3 overflow-y-auto pr-2 text-xs font-mono">
                      {recentEvents.map((evt) => (
                        <div
                          key={evt.id}
                          className="rounded-lg border border-border/60 bg-background/50 p-3"
                        >
                          <p className="font-semibold">{evt.type}</p>
                          <p className="text-muted-foreground">
                            {new Date(evt.ts).toLocaleString()}
                          </p>
                        </div>
                      ))}
                      {!recentEvents.length && (
                        <p className="text-muted-foreground">No recent events.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="logs" className="mt-4 flex-1">
                <Card className="h-full">
                  <CardHeader>
                    <CardDescription>Recent log entries</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 space-y-3 overflow-y-auto pr-2 text-xs">
                      {recentLogs.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-lg border border-border/60 bg-background/50 p-3"
                        >
                          <div className="flex items-center gap-2 font-semibold">
                            <Badge variant="outline">{entry.level}</Badge>
                            <span>{entry.name}</span>
                          </div>
                          <p className="text-muted-foreground">{entry.msg}</p>
                        </div>
                      ))}
                      {!recentLogs.length && <p className="text-muted-foreground">No logs yet.</p>}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardDescription>Load Backtest Artifact</CardDescription>
                <CardTitle className="text-lg">Publishing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    value={backtestUrl}
                    onChange={(evt) => setBacktestUrl(evt.target.value)}
                    placeholder="https://example.com/artifact.json"
                  />
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      if (!backtestUrl) return;
                      const res = await fetch(backtestUrl);
                      if (!res.ok) {
                        alert(`Failed to load artifact (${res.status})`);
                        return;
                      }
                      setBacktest((await res.json()) as BacktestArtifact);
                    }}
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" onClick={() => setBacktest(null)}>
                    Reset
                  </Button>
                </div>
                {backtest ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold">{backtest.summary.symbol}</p>
                      <p className="text-xs text-muted-foreground">
                        {backtest.summary.events} events · {backtest.summary.ticksUsed} ticks
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <SummaryTile
                        label="Sharpe"
                        value={formatNumber(backtest.summary.sharpe, 3)}
                      />
                      <SummaryTile
                        label="Max DD %"
                        value={formatPercent(backtest.summary.maxDrawdownPct)}
                      />
                    </div>
                    <Sparkline values={backtest.navCurve.map((p) => p.nav)} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Publish via `rx backtest --publish` or load a JSON file to inspect stats here.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Recent Backtests</CardDescription>
                <CardTitle className="text-lg">History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-border/40 bg-background/40 p-3"
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{new Date(entry.ts).toLocaleString()}</span>
                      <span>{entry.summary?.symbol ?? '—'}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase">Sharpe</p>
                        <p className="font-semibold">{formatNumber(entry.summary?.sharpe, 2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase">Max DD %</p>
                        <p className="font-semibold">
                          {formatPercent(Math.abs(entry.summary?.maxDrawdownPct ?? 0))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase">Runtime</p>
                        <p className="font-semibold">
                          {formatNumber(entry.summary?.runtimeMs ?? 0, 0)}ms
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {!history.length && (
                  <p className="text-sm text-muted-foreground">No artifacts published.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
};
