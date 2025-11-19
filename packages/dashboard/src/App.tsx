import { useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDashboardData } from './hooks/useDashboardData';
import { useDashboardStore } from './state/dashboardStore';
import { useStrategySelection } from './hooks/useStrategySelection';
import { usePnlHistory } from './hooks/usePnlHistory';
import { useThroughput } from './hooks/useThroughput';
import { StrategyHealthCard } from './components/StrategyHealthCard';
import { StrategyMixerCard } from './components/StrategyMixerCard';
import { StrategyDetailsCard } from './components/StrategyDetailsCard';
import { PositionsCard } from './components/PositionsCard';
import { OrdersCard } from './components/OrdersCard';
import { AccountBalancesCard } from './components/AccountBalancesCard';
import { MarginOverviewCard } from './components/MarginOverviewCard';
import { TradesCard } from './components/TradesCard';
import { EventsLogsTabs } from './components/EventsLogsTabs';
import { BacktestPanel } from './components/BacktestPanel';
import { GatewayCard } from './components/GatewayCard';
import { StatusHeader } from './components/StatusHeader';
import { PnlTimelineCard } from './components/PnlTimelineCard';
import { formatNumber, formatAgo } from './lib/format';
import type { BalanceEntry, MarginSummary, PositionSnapshot } from './types';
import { PortfolioOverviewCard } from './components/PortfolioOverviewCard';
import { StrategyFlowTab } from './components/StrategyFlowTab';

export const App = () => {
  const { events, logs, eventStreamStatus, logStreamStatus } = useDashboardData();
  const pnl = useDashboardStore((s) => s.pnl);
  const positions = useDashboardStore((s) => s.positions);
  const publishedArtifact = useDashboardStore((s) => s.publishedArtifact);
  const artifactHistory = useDashboardStore((s) => s.artifactHistory);
  const statusData = useDashboardStore((s) => s.status);
  const accountBalances = useDashboardStore((s) => s.accountBalances);
  const accountMargin = useDashboardStore((s) => s.accountMargin);
  const recentOrders = useDashboardStore((s) => s.recentOrders);
  const recentDomainEvents = useDashboardStore((s) => s.recentEvents);
  const trades = useDashboardStore((s) => s.trades);
  const setArtifact = useDashboardStore((s) => s.setPublishedArtifact);

  const pnlHistory = usePnlHistory(pnl);
  const throughput = useThroughput(events);

  const feedHealth = statusData?.feeds ?? [];
  const feedSummary = useMemo(() => {
    const total = feedHealth.length;
    const connected = feedHealth.filter((feed) => feed.status === 'connected').length;
    const stale = feedHealth.filter((feed) => (feed.ageSeconds ?? 0) > 10).length;
    return { total, connected, stale };
  }, [feedHealth]);

  const {
    rows: strategyRows,
    selectedStrategy,
    selectedStrategyId,
    setSelectedStrategyId,
    aggregatedMetrics,
    options: strategyOptions,
    focusLabel,
  } = useStrategySelection(statusData?.runtime.strategies);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleStrategySelect = (id: string) => {
    setSelectedStrategyId(id);
    setIsSidebarOpen(true);
  };

  const venueLabel = (feed?: string | null) => {
    if (!feed) return '—';
    const normalized = feed.toLowerCase();
    if (normalized === 'binance') return 'Binance';
    if (normalized === 'hyperliquid') return 'Hyperliquid';
    if (normalized === 'paper') return 'Paper';
    return feed;
  };

  const symbolVenueLookup = useMemo(() => {
    const map = new Map<string, string>();
    statusData?.runtime.strategies?.forEach((strategy) => {
      map.set(strategy.tradeSymbol, venueLabel(strategy.primaryFeed));
    });
    if (statusData?.runtime.strategy) {
      const primary = statusData.runtime.strategy;
      if (!map.has(primary.tradeSymbol)) {
        map.set(primary.tradeSymbol, venueLabel(primary.primaryFeed));
      }
    }
    return map;
  }, [statusData?.runtime.strategies, statusData?.runtime.strategy]);

  const positionEntries = Object.entries(positions ?? {}) as Array<[string, PositionSnapshot]>;

  const positionRows = useMemo(
    () =>
      positionEntries
        .map(([symbol, snap]) => {
          const netRealized = snap.netRealized ?? snap.realized ?? 0;
          const grossRealized = snap.grossRealized ?? 0;
          const unrealized = snap.unrealized ?? 0;
          const pnl = snap.pnl ?? netRealized + unrealized;
          const px = snap.px ?? 0;
          const pos = snap.pos ?? 0;
          const notional = Math.abs(px * pos);
          return {
            symbol,
            venue: symbolVenueLookup.get(symbol) ?? '—',
            pos,
            avgPx: snap.avgPx,
            px,
            value: px * pos,
            notional,
            pnl,
            realized: netRealized,
            grossRealized,
            unrealized,
          };
        })
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    [positionEntries, symbolVenueLookup],
  );

  const displayedPositions = useMemo(() => {
    if (!selectedStrategy) return positionRows;
    const targetVenue = venueLabel(selectedStrategy.primaryFeed);
    return positionRows.filter(
      (row) => row.symbol === selectedStrategy.tradeSymbol && row.venue === targetVenue,
    );
  }, [positionRows, selectedStrategy]);

  const summarizedOrders = useMemo(() => {
    return recentOrders.map((order) => {
      const data = (order.data ?? {}) as Record<string, unknown>;
      const meta = (data.meta as Record<string, unknown>) ?? {};
      return {
        id: order.id,
        ts: order.ts,
        type: order.type,
        summary: {
          symbol: (data.symbol ?? meta.symbol ?? '—') as string,
          side: (data.side ?? meta.side ?? '—') as string,
          qty: (data.qty ?? meta.qty ?? meta.size ?? null) as number | null,
          px: (data.px ?? meta.execRefPx ?? meta.px ?? null) as number | null,
          strategyId: (meta.strategyId as string | undefined) ?? null,
        },
      };
    });
  }, [recentOrders]);

  const displayedOrders = useMemo(() => {
    if (!selectedStrategy) return summarizedOrders;
    return summarizedOrders.filter((order) => {
      const strategyId = order.summary.strategyId;
      if (strategyId) return strategyId === selectedStrategy.id;
      return order.summary.symbol === selectedStrategy.tradeSymbol;
    });
  }, [summarizedOrders, selectedStrategy]);

  const balanceRows = useMemo<Array<BalanceEntry & { venue: string }>>(() => {
    if (!accountBalances?.balances) return [];
    return Object.entries(accountBalances.balances)
      .flatMap(([venue, assets]) =>
        Object.values(assets ?? {}).map((entry) => ({ ...entry, venue })),
      )
      .sort((a, b) => `${a.venue}-${a.asset}`.localeCompare(`${b.venue}-${b.asset}`));
  }, [accountBalances?.balances]);

  const marginRows = useMemo<MarginSummary[]>(() => {
    if (!accountMargin?.summaries) return [];
    return Object.entries(accountMargin.summaries)
      .map(([venue, summary]) => ({ ...summary, venue }))
      .sort((a, b) => a.venue.localeCompare(b.venue));
  }, [accountMargin?.summaries]);

  const marginSnapshot = useMemo(() => {
    if (!marginRows.length) return null;
    const used = marginRows.reduce((acc, row) => acc + (row.marginUsed ?? 0), 0);
    const equity = marginRows.reduce((acc, row) => acc + (row.equity ?? 0), 0);
    const available = Math.max(0, equity - used);
    return { used, available };
  }, [marginRows]);

  const statusNav = pnl?.nav ?? statusData?.metrics.nav;
  const statusNetRealized =
    pnl?.netRealized ??
    pnl?.realized ??
    statusData?.metrics.netRealized ??
    statusData?.metrics.realized ??
    null;
  const statusGrossRealized = pnl?.grossRealized ?? statusData?.metrics.grossRealized ?? null;
  const statusUnrealized = pnl?.unrealized ?? statusData?.metrics.unrealized;
  const statusFees = pnl?.feesPaid ?? statusData?.metrics.feesPaid;

  const [gatewayUrl, setGatewayUrl] = useState(
    () => import.meta.env.VITE_GATEWAY_URL ?? window.location.origin,
  );
  const openInNewTab = (path: string) => {
    const url = path.startsWith('http') ? path : `${gatewayUrl}${path}`;
    window.open(url, '_blank', 'noreferrer');
  };

  const eventsPerMinute = (
    (throughput.ticksPerSec + throughput.signalsPerSec + throughput.ordersPerSec) *
    60
  ).toFixed(0);
  const modeLabel = statusData?.runtime.live ? 'Live trading' : 'Paper mode';
  const modeIntent = statusData?.runtime.live ? 'ok' : 'warn';
  const gatewayPersistence = statusData?.persistence ?? null;
  const balanceSync = statusData?.accounting?.balanceSync ?? null;
  const showSseWarning = eventStreamStatus !== 'open' || logStreamStatus !== 'open';

  return (
    <div className="flex h-screen w-full bg-background text-xs overflow-hidden">
      {/* Main App Content */}
      <div className="flex flex-col flex-1 overflow-hidden transition-all duration-300">
      <div className="border-b p-2">
        <StatusHeader
          modeLabel={modeLabel}
          modeIntent={modeIntent}
          feedSummary={feedSummary}
          feeds={feedHealth}
          lastEventTs={statusData?.metrics.lastEventTs ?? null}
          lastLogTs={statusData?.metrics.lastLogTs ?? null}
          killSwitch={Boolean(statusData?.runtime.killSwitch)}
          eventStreamStatus={eventStreamStatus}
          logStreamStatus={logStreamStatus}
          showWarning={showSseWarning}
          onOpenControl={() => openInNewTab('/')}
          onOpenMetrics={() => openInNewTab('/metrics')}
          marginSnapshot={marginSnapshot}
        />
      </div>

      <div className="flex-1 overflow-hidden p-2">
        <Tabs defaultValue="live" className="flex h-full flex-col">
          <div className="flex items-center justify-between px-1 pb-2">
            <TabsList className="h-7 bg-muted/20 p-0.5">
              <TabsTrigger value="live" className="h-6 px-3 text-[10px]">Live Dashboard</TabsTrigger>
              <TabsTrigger value="health" className="h-6 px-3 text-[10px]">System Health</TabsTrigger>
              <TabsTrigger value="flow" className="h-6 px-3 text-[10px]">Strategy Flow</TabsTrigger>
              <TabsTrigger value="backtest" className="h-6 px-3 text-[10px]">Backtesting</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="live" className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
            <div className="flex h-full gap-2">
              {/* Left Column: Strategy & Control (Fixed Width) */}
              <div className="flex flex-col gap-2 w-[320px] shrink-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                  <StrategyMixerCard
                    rows={strategyRows}
                    selectedStrategyId={selectedStrategyId}
                    onSelect={handleStrategySelect}
                    options={strategyOptions}
                    focusLabel={focusLabel}
                    aggregatedMetrics={aggregatedMetrics}
                    selectedStrategy={selectedStrategy}
                    formatAgo={formatAgo}
                  />
                </div>
                <div className="shrink-0">
                  <GatewayCard
                    gatewayUrl={gatewayUrl}
                    onGatewayChange={setGatewayUrl}
                    onCopy={() => navigator.clipboard.writeText(gatewayUrl)}
                    onOpenControl={() => openInNewTab('/')}
                    onOpenMetrics={() => openInNewTab('/metrics')}
                  />
                </div>
              </div>

              {/* Main Content Area (Flex Grow) */}
              <div className="flex-1 grid grid-cols-12 gap-2 overflow-hidden">

              {/* Middle Column: Market Data (6 cols) */}
              <div className="col-span-6 flex flex-col gap-2 overflow-hidden">
                <div className="shrink-0">
                  <PortfolioOverviewCard
                    nav={statusNav}
                    netRealized={statusNetRealized}
                    grossRealized={statusGrossRealized}
                    unrealized={statusUnrealized}
                    feesPaid={statusFees}
                    positions={positionEntries}
                    balances={balanceRows}
                    formatNumber={formatNumber}
                  />
                </div>
                <div className="flex-1 overflow-y-auto">
                  <PositionsCard
                    rows={displayedPositions}
                    totalSymbols={positionEntries.length}
                    selectedStrategy={selectedStrategy}
                    formatNumber={formatNumber}
                  />
                </div>
                <div className="h-1/3 overflow-y-auto">
                  <OrdersCard
                    orders={displayedOrders}
                    selectedStrategy={selectedStrategy}
                    formatNumber={formatNumber}
                  />
                </div>
              </div>

              {/* Right Column: Account & Logs (3 cols) */}
              <div className="col-span-6 flex flex-col gap-2 overflow-hidden">
                <div className="h-1/3 overflow-y-auto">
                  <PnlTimelineCard history={pnlHistory} />
                </div>
                <div className="h-1/3 overflow-y-auto">
                  <TradesCard
                    openTrades={trades?.open ?? []}
                    closedTrades={trades?.closed ?? []}
                    formatNumber={formatNumber}
                    formatAgo={formatAgo}
                  />
                </div>
                <div className="flex-1 overflow-hidden flex flex-col gap-2">
                  <div className="flex-1 overflow-y-auto">
                    <EventsLogsTabs
                      events={recentDomainEvents ?? events.slice(0, 10)}
                      logs={logs.slice(0, 10)}
                    />
                  </div>
                  <div className="shrink-0">
                    <AccountBalancesCard
                      balances={balanceRows}
                      updated={accountBalances?.updated ?? null}
                      balanceSync={balanceSync}
                    />
                  </div>
                </div>
              </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="health" className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden p-2">
            <StrategyHealthCard
              strategies={statusData?.runtime.strategies ?? []}
              feeds={statusData?.feeds ?? []}
              formatNumber={formatNumber}
              formatAgo={formatAgo}
            />
          </TabsContent>

          <TabsContent value="backtest" className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden p-1">
            <BacktestPanel
              artifact={publishedArtifact}
              onArtifactChange={setArtifact}
              history={artifactHistory}
            />
          </TabsContent>

          <TabsContent value="flow" className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden p-1">
            <StrategyFlowTab strategies={statusData?.runtime.strategies ?? []} />
          </TabsContent>
        </Tabs>
      </div>
    </div>

    {/* Full-Height Inline Details Panel */}
    {isSidebarOpen && (
      <div className="w-[400px] border-l border-border bg-card/50 overflow-y-auto animate-in slide-in-from-right duration-300">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider">Strategy Details</h2>
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <StrategyDetailsCard
            selectedStrategy={selectedStrategy}
            fallbackStrategy={statusData?.runtime.strategy ?? null}
            persistence={gatewayPersistence}
            options={strategyOptions}
            onSelect={setSelectedStrategyId}
            selectedStrategyId={selectedStrategyId}
          />
        </div>
      </div>
    )}
  </div>
  );
};
