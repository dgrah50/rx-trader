import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PnlChart, type SeriesPoint } from './PnlChart';
import { formatNumber } from '../lib/format';
import { Zap, Signal } from 'lucide-react';

interface PnlTimelineCardProps {
  history: SeriesPoint[];
}

export const PnlTimelineCard = ({ history }: PnlTimelineCardProps) => (
  <Card className="h-full flex flex-col border-0 shadow-none bg-transparent">
    <div className="flex items-center justify-between px-1 pb-2 border-b border-border/40 mb-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">PnL History</span>
      </div>
      <div className="flex gap-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <Zap className="h-3 w-3 text-emerald-400" />
          <span className="font-mono">{formatNumber(history.at(-1)?.value ?? null)}</span>
        </div>
      </div>
    </div>
    <div className="flex-1 min-h-0 -mx-1">
      <PnlChart points={history} />
    </div>
  </Card>
);
