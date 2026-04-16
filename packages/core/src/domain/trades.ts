export type TradeDirection = 'LONG' | 'SHORT';

export interface TradeSummary {
  symbol: string;
  venue?: string;
  qty: number;
  direction: TradeDirection;
  entryPx: number;
  entryTs: number;
  fees: number;
}

export interface OpenTrade extends TradeSummary {
  markPx: number;
  unrealizedPnl: number;
}

export interface ClosedTrade extends TradeSummary {
  exitPx: number;
  exitTs: number;
  realizedPnl: number;
}

export interface TradesResponse {
  open: OpenTrade[];
  closed: ClosedTrade[];
}
