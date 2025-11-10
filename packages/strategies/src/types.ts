export type StrategyAction = 'BUY' | 'SELL';

export interface StrategySignal {
  symbol: string;
  action: StrategyAction;
  px: number;
  t: number;
}
