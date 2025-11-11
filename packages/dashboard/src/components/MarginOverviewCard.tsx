import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { MarginSummary } from '../types';
import { formatAgo, formatNumber } from '../lib/format';
import { Badge } from '@/components/ui/badge';

interface MarginOverviewCardProps {
  rows: MarginSummary[];
  updated: number | null;
}

export const MarginOverviewCard = ({ rows, updated }: MarginOverviewCardProps) => (
  <Card>
    <CardHeader className="flex flex-col gap-2">
      <div>
        <CardDescription>Collateral</CardDescription>
        <CardTitle className="text-xl">Margin Overview</CardTitle>
      </div>
      <div className="text-xs text-muted-foreground">
        {rows.length} venues · Updated {formatAgo(updated)}
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      {rows.length ? (
        rows.map((summary) => {
          const free = summary.equity - summary.marginUsed;
          return (
            <div key={summary.venue} className="rounded-xl border border-border/50 bg-background/40 p-3">
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>{summary.venue}</span>
                <Badge variant="outline">{summary.collateralAsset}</Badge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div>
                  <p className="uppercase tracking-wide">Equity</p>
                  <p className="text-base font-semibold text-foreground">${formatNumber(summary.equity)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wide">Used</p>
                  <p className="text-base font-semibold text-foreground">${formatNumber(summary.marginUsed)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wide">Free</p>
                  <p className="text-base font-semibold text-emerald-400">${formatNumber(free)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wide">Maintenance</p>
                  <p className="text-base font-semibold text-foreground">${formatNumber(summary.maintenance)}</p>
                </div>
              </div>
              {summary.leverageCap ? (
                <p className="mt-2 text-xs text-muted-foreground">Leverage cap {summary.leverageCap}×</p>
              ) : null}
            </div>
          );
        })
      ) : (
        <p className="text-sm text-muted-foreground">No margin snapshots yet.</p>
      )}
    </CardContent>
  </Card>
);
