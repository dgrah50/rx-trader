import { useEffect, useState } from 'react';
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
  StatusResponse,
  TradesResponse
} from '../types';

interface DashboardDataResult {
  events: EventMessage[];
  logs: LogEntry[];
  eventStreamStatus: StreamStatus;
  logStreamStatus: StreamStatus;
}

export const useDashboardData = (): DashboardDataResult => {
  const { events: liveEvents, status: eventStreamStatus } = useEventStream<EventMessage>('/events');
  const { events: logs, status: logStreamStatus } = useEventStream<LogEntry>('/logs');
  const { data: pnl } = usePolling<PnlResponse>('/pnl', 4_000);
  const { data: positions } = usePolling<PositionsResponse>('/positions', 6_000);
  const { data: publishedArtifact } = usePolling<BacktestArtifact | null>('/backtest/artifacts', 5_000);
  const { data: artifactHistory } = usePolling<BacktestHistoryEntry[]>('/backtest/artifacts/history?limit=12', 8_000);
  const { data: statusData } = usePolling<StatusResponse>('/status', 5_000);
  const { data: recentOrders } = usePolling<OrderEvent[]>('/orders/recent?limit=12', 5_000);
  const { data: accountBalances } = usePolling<AccountBalancesResponse>('/account/balances', 10_000);
  const { data: accountMargin } = usePolling<AccountMarginResponse>('/account/margin', 12_000);
  const { data: trades } = usePolling<TradesResponse>('/trades', 5_000);

  const setPnl = useDashboardStore((state) => state.setPnl);
  const setPositions = useDashboardStore((state) => state.setPositions);
  const setArtifact = useDashboardStore((state) => state.setPublishedArtifact);
  const setArtifactHistory = useDashboardStore((state) => state.setArtifactHistory);
  const setStatus = useDashboardStore((state) => state.setStatus);
  const setRecentOrders = useDashboardStore((state) => state.setRecentOrders);
  const setRecentEvents = useDashboardStore((state) => state.setRecentEvents);
  const setBalances = useDashboardStore((state) => state.setAccountBalances);
  const setMargin = useDashboardStore((state) => state.setAccountMargin);
  const setTrades = useDashboardStore((state) => state.setTrades);

  // Initial fetch for history
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const baseUrl = import.meta.env.VITE_GATEWAY_URL ?? window.location.origin;
        const res = await fetch(new URL('/events/recent?limit=50', baseUrl));
        if (res.ok) {
          const history = await res.json() as EventMessage[];
          setRecentEvents(history);
        }
      } catch (e) {
        console.error('Failed to fetch event history', e);
      }
    };
    fetchHistory();
  }, [setRecentEvents]);

  // Merge live events with existing state (which starts with history)
  // Actually, since useEventStream accumulates liveEvents locally, we should merge liveEvents with the *initial* history we fetched.
  // But we don't want to keep fetching history.
  // Strategy:
  // 1. Fetch history once, set it to store.
  // 2. When liveEvents updates, merge it with the CURRENT store value? No, store value might be stale or modified?
  // Better: Keep history in a ref or state here, and merge with liveEvents, then push to store.
  
  // Let's use a simpler approach:
  // The store is the source of truth.
  // But useEventStream has its own state.
  // We can't easily merge "liveEvents" (which grows from 0) with "history" (static) without duplicates if we are not careful.
  // However, liveEvents will only contain events arriving AFTER connection.
  // History contains events BEFORE connection (mostly).
  // There might be a small overlap or gap.
  // Let's just combine them.
  
  // We need to persist the history somewhere so it doesn't disappear when this hook re-renders.
  // Actually, we can just rely on the store?
  // If we update the store with history once.
  // Then we update the store with "liveEvents + history" every time liveEvents changes?
  // That requires keeping history in state here.
  
  const [history, setHistory] = useState<EventMessage[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const baseUrl = import.meta.env.VITE_GATEWAY_URL ?? window.location.origin;
        const res = await fetch(new URL('/events/recent?limit=50', baseUrl));
        if (res.ok) {
          const data = await res.json() as EventMessage[];
          setHistory(data);
        }
      } catch (e) {
        console.error('Failed to fetch event history', e);
      }
    };
    fetchHistory();
  }, []);

  useEffect(() => {
    // Combine liveEvents and history
    // liveEvents are newest first (from useEventStream implementation: [new, ...prev])
    // history is likely newest first too (from API).
    
    const combined = [...liveEvents, ...history];
    // Dedup by ID
    const seen = new Set();
    const unique = [];
    for (const event of combined) {
      if (!seen.has(event.id)) {
        seen.add(event.id);
        unique.push(event);
      }
    }
    // Sort by TS desc just in case
    unique.sort((a, b) => b.ts - a.ts);
    
    // Limit to 50
    const limited = unique.slice(0, 50);
    
    setRecentEvents(limited);
  }, [liveEvents, history, setRecentEvents]);

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
    setBalances(accountBalances ?? null);
  }, [accountBalances, setBalances]);

  useEffect(() => {
    setMargin(accountMargin ?? null);
  }, [accountMargin, setMargin]);

  useEffect(() => {
    setTrades(trades ?? null);
  }, [trades, setTrades]);

  return { events: liveEvents, logs, eventStreamStatus, logStreamStatus };
};
