export interface RebalanceTarget {
  venue: string;
  asset: string;
  min?: number;
  max?: number;
  target?: number;
  priority?: number;
}
