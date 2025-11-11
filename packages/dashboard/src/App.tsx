import { useMemo, useState } from 'react';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider, SidebarRail } from '@/components/ui/sidebar';
import { useDashboardData } from './hooks/useDashboardData';
import { useDashboardStore } from './state/dashboardStore';
import { useStrategySelection } from './hooks/useStrategySelection';
import { usePnlHistory } from './hooks/usePnlHistory';
import { useThroughput } from './hooks/useThroughput';
import { StrategyMixerCard } from './components/StrategyMixerCard';
import { StrategyDetailsCard } from './components/StrategyDetailsCard';
import { PositionsCard } from './components/PositionsCard';
import { OrdersCard } from './components/OrdersCard';
import { AccountBalancesCard } from './components/AccountBalancesCard';
import { MarginOverviewCard } from './components/MarginOverviewCard';
import { EventsLogsTabs } from './components/EventsLogsTabs';
import { BacktestPanel } from './components/BacktestPanel';
import { GatewayCard } from './components/GatewayCard';
import { StatusHeader } from './components/StatusHeader';
import { PnlTimelineCard } from './components/PnlTimelineCard';
import { formatNumber, formatPercent, formatAgo } from './lib/format';
import type { BalanceEntry, MarginSummary } from './types';
import { PortfolioOverviewCard } from './components/PortfolioOverviewCard';

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

  const positionEntries = Object.entries(positions ?? {});
  const displayedPositions = useMemo(() => {
    if (!selectedStrategy) return positionEntries;
    return positionEntries.filter(([symbol]) => symbol === selectedStrategy.tradeSymbol);
  }, [positionEntries, selectedStrategy]);

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

  const statusNav = statusData?.metrics.nav ?? pnl?.nav;
  const statusRealized = statusData?.metrics.realized ?? pnl?.realized;
  const statusUnrealized = statusData?.metrics.unrealized ?? pnl?.unrealized;

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
    <SidebarProvider>
      <SidebarRail />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-6 p-4 lg:p-8">
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

          <PortfolioOverviewCard
            nav={statusNav}
            realized={statusRealized}
            unrealized={statusUnrealized}
            positions={positionEntries}
            balances={balanceRows}
            formatNumber={formatNumber}
          />

          <div className="grid gap-6 2xl:grid-cols-[3fr_2fr]">
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <PositionsCard
                  positions={displayedPositions}
                  totalSymbols={positionEntries.length}
                  selectedStrategy={selectedStrategy}
                  formatNumber={formatNumber}
                />
                <OrdersCard
                  orders={displayedOrders}
                  selectedStrategy={selectedStrategy}
                  formatNumber={formatNumber}
                />
              </div>
              <StrategyMixerCard
                rows={strategyRows}
                selectedStrategyId={selectedStrategyId}
                onSelect={setSelectedStrategyId}
                options={strategyOptions}
                focusLabel={focusLabel}
                aggregatedMetrics={aggregatedMetrics}
                selectedStrategy={selectedStrategy}
                formatAgo={formatAgo}
              />
              <PnlTimelineCard history={pnlHistory} />
            </div>
            <div className="space-y-6">
              <StrategyDetailsCard
                selectedStrategy={selectedStrategy}
                fallbackStrategy={statusData?.runtime.strategy ?? null}
                persistence={gatewayPersistence}
              />
              <AccountBalancesCard
                balances={balanceRows}
                updated={accountBalances?.updated ?? null}
                balanceSync={balanceSync}
              />
              <MarginOverviewCard rows={marginRows} updated={accountMargin?.updated ?? null} />
              <EventsLogsTabs
                events={recentDomainEvents ?? events.slice(0, 10)}
                logs={logs.slice(0, 10)}
              />
              <GatewayCard
                gatewayUrl={gatewayUrl}
                onGatewayChange={setGatewayUrl}
                onCopy={() => navigator.clipboard.writeText(gatewayUrl)}
                onOpenControl={() => openInNewTab('/')}
                onOpenMetrics={() => openInNewTab('/metrics')}
              />
            </div>
          </div>

          <BacktestPanel
            artifact={publishedArtifact}
            onArtifactChange={setArtifact}
            history={artifactHistory}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
};
