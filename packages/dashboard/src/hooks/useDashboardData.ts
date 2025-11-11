import { useEffect } from 'react';
import { useEventStream, usePolling, type StreamStatus } from '../hooks';
import { useDashboardStore } from '../state/dashboardStore';
import type {
  AccountBalancesResponse,
  AccountMarginResponse,
  BacktestArtifact,
  BacktestHistoryEntry,
  EventMessage,
  LogEntry,
  OrderEvent,
  PnlResponse,
  PositionsResponse,
  StatusResponse
} from '../types';

interface DashboardDataResult {
  events: EventMessage[];
  logs: LogEntry[];
  eventStreamStatus: StreamStatus;
  logStreamStatus: StreamStatus;
}

export const useDashboardData = (): DashboardDataResult => {
  const { events, status: eventStreamStatus } = useEventStream<EventMessage>('/events');
  const { events: logs, status: logStreamStatus } = useEventStream<LogEntry>('/logs');
  const { data: pnl } = usePolling<PnlResponse>('/pnl', 4_000);
  const { data: positions } = usePolling<PositionsResponse>('/positions', 6_000);
  const { data: publishedArtifact } = usePolling<BacktestArtifact | null>('/backtest/artifacts', 5_000);
  const { data: artifactHistory } = usePolling<BacktestHistoryEntry[]>('/backtest/artifacts/history?limit=12', 8_000);
  const { data: statusData } = usePolling<StatusResponse>('/status', 5_000);
  const { data: recentOrders } = usePolling<OrderEvent[]>('/orders/recent?limit=12', 5_000);
  const { data: recentDomainEvents } = usePolling<EventMessage[]>('/events/recent?limit=12', 5_000);
  const { data: accountBalances } = usePolling<AccountBalancesResponse>('/account/balances', 10_000);
  const { data: accountMargin } = usePolling<AccountMarginResponse>('/account/margin', 12_000);

  const setPnl = useDashboardStore((state) => state.setPnl);
  const setPositions = useDashboardStore((state) => state.setPositions);
  const setArtifact = useDashboardStore((state) => state.setPublishedArtifact);
  const setArtifactHistory = useDashboardStore((state) => state.setArtifactHistory);
  const setStatus = useDashboardStore((state) => state.setStatus);
  const setRecentOrders = useDashboardStore((state) => state.setRecentOrders);
  const setRecentEvents = useDashboardStore((state) => state.setRecentEvents);
  const setBalances = useDashboardStore((state) => state.setAccountBalances);
  const setMargin = useDashboardStore((state) => state.setAccountMargin);

  useEffect(() => {
    setPnl(pnl ?? null);
  }, [pnl, setPnl]);

  useEffect(() => {
    setPositions(positions ?? null);
  }, [positions, setPositions]);

  useEffect(() => {
    setArtifact(publishedArtifact ?? null);
  }, [publishedArtifact, setArtifact]);

  useEffect(() => {
    if (artifactHistory) {
      setArtifactHistory(artifactHistory);
    }
  }, [artifactHistory, setArtifactHistory]);

  useEffect(() => {
    setStatus(statusData ?? null);
  }, [statusData, setStatus]);

  useEffect(() => {
    if (recentOrders) {
      setRecentOrders(recentOrders);
    }
  }, [recentOrders, setRecentOrders]);

  useEffect(() => {
    if (recentDomainEvents) {
      setRecentEvents(recentDomainEvents);
    }
  }, [recentDomainEvents, setRecentEvents]);

  useEffect(() => {
    setBalances(accountBalances ?? null);
  }, [accountBalances, setBalances]);

  useEffect(() => {
    setMargin(accountMargin ?? null);
  }, [accountMargin, setMargin]);

  return { events, logs, eventStreamStatus, logStreamStatus };
};
