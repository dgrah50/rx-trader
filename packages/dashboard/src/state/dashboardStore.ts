import { create } from 'zustand';
import type {
  AccountBalancesResponse,
  AccountMarginResponse,
  BacktestArtifact,
  BacktestHistoryEntry,
  EventMessage,
  OrderEvent,
  PnlResponse,
  PositionsResponse,
  StatusResponse,
  TradesResponse
} from '../types';

interface DashboardState {
  pnl: PnlResponse | null;
  positions: PositionsResponse | null;
  publishedArtifact: BacktestArtifact | null;
  artifactHistory: BacktestHistoryEntry[];
  status: StatusResponse | null;
  recentOrders: OrderEvent[];
  recentEvents: EventMessage[];
  accountBalances: AccountBalancesResponse | null;
  accountMargin: AccountMarginResponse | null;
  trades: TradesResponse | null;
  setPnl: (pnl: PnlResponse | null) => void;
  setPositions: (positions: PositionsResponse | null) => void;
  setPublishedArtifact: (artifact: BacktestArtifact | null) => void;
  setArtifactHistory: (history: BacktestHistoryEntry[]) => void;
  setStatus: (status: StatusResponse | null) => void;
  setRecentOrders: (orders: OrderEvent[]) => void;
  setRecentEvents: (events: EventMessage[]) => void;
  setAccountBalances: (balances: AccountBalancesResponse | null) => void;
  setAccountMargin: (margin: AccountMarginResponse | null) => void;
  setTrades: (trades: TradesResponse | null) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  pnl: null,
  positions: null,
  publishedArtifact: null,
  artifactHistory: [],
  status: null,
  recentOrders: [],
  recentEvents: [],
  accountBalances: null,
  accountMargin: null,
  trades: null,
  setPnl: (pnl) => set({ pnl }),
  setPositions: (positions) => set({ positions }),
  setPublishedArtifact: (publishedArtifact) => set({ publishedArtifact }),
  setArtifactHistory: (artifactHistory) => set({ artifactHistory }),
  setStatus: (status) => set({ status }),
  setRecentOrders: (recentOrders) => set({ recentOrders }),
  setRecentEvents: (recentEvents) => set({ recentEvents }),
  setAccountBalances: (accountBalances) => set({ accountBalances }),
  setAccountMargin: (accountMargin) => set({ accountMargin }),
  setTrades: (trades) => set({ trades })
}));
