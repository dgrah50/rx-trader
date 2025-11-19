import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { MarginSummary } from '../types';
import { formatAgo, formatNumber } from '../lib/format';
import { Badge } from '@/components/ui/badge';

interface MarginOverviewCardProps {
  rows: MarginSummary[];
  updated: number | null;
}

export const MarginOverviewCard = ({ rows, updated }: MarginOverviewCardProps) => (
  <Card className="h-full flex flex-col border-0 shadow-none bg-transparent">
    <div className="flex items-center justify-between px-1 pb-2 border-b border-border/40 mb-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Margin</span>
      <span className="text-[10px] text-muted-foreground">Updated {formatAgo(updated)}</span>
    </div>
    
    <div className="flex-1 overflow-auto min-h-0 space-y-2">
      {rows.length ? (
        rows.map((summary) => {
          const free = summary.equity - summary.marginUsed;
          return (
            <div key={summary.venue} className="rounded-sm border border-border/40 bg-card/30 p-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">{summary.venue}</span>
                <Badge variant="outline" className="text-[9px] h-4 px-1">{summary.collateralAsset}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground uppercase tracking-wider">Equity</span>
                  <span className="font-mono font-medium">${formatNumber(summary.equity)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground uppercase tracking-wider">Used</span>
                  <span className="font-mono font-medium">${formatNumber(summary.marginUsed)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground uppercase tracking-wider">Free</span>
                  <span className="font-mono font-medium text-emerald-400">${formatNumber(free)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground uppercase tracking-wider">Maint</span>
                  <span className="font-mono font-medium">${formatNumber(summary.maintenance)}</span>
                </div>
              </div>
              {summary.leverageCap ? (
                <div className="mt-1 text-[9px] text-muted-foreground text-right">
                  Max Lev: {summary.leverageCap}×
                </div>
              ) : null}
            </div>
          );
        })
      ) : (
        <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
          No margin data.
        </div>
      )}
    </div>
  </Card>
);
