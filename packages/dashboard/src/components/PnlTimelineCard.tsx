import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PnlChart, type SeriesPoint } from './PnlChart';
import { formatNumber } from '../lib/format';
import { Zap, Signal } from 'lucide-react';

interface PnlTimelineCardProps {
  history: SeriesPoint[];
}

export const PnlTimelineCard = ({ history }: PnlTimelineCardProps) => (
  <Card className="lg:col-span-2">
    <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <CardDescription>Portfolio</CardDescription>
        <CardTitle className="text-2xl font-semibold">PnL Timeline</CardTitle>
      </div>
      <div className="flex gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Zap className="h-3.5 w-3.5 text-emerald-400" />
          <span>{formatNumber(history.at(-1)?.value ?? null)} latest</span>
        </div>
        <div className="flex items-center gap-1">
          <Signal className="h-3.5 w-3.5 text-indigo-400" />
          <span>{history.length} samples</span>
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <PnlChart points={history} />
    </CardContent>
  </Card>
);
