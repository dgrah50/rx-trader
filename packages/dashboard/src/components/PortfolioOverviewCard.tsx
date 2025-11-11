import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { BalanceEntry } from '../types';
import { cn } from '@/lib/utils';

interface PositionSnapshot {
  pos: number;
  avgPx: number;
  px: number;
  pnl: number;
}

interface PortfolioOverviewProps {
  nav: number | null | undefined;
  realized: number | null | undefined;
  unrealized: number | null | undefined;
  positions: Array<[string, PositionSnapshot]>;
  balances: Array<BalanceEntry & { venue: string }>; 
  formatNumber: (value: number | null | undefined, precision?: number) => string;
}

export const PortfolioOverviewCard = ({
  nav,
  realized,
  unrealized,
  positions,
  balances,
  formatNumber
}: PortfolioOverviewProps) => {
  const exposureTotals = positions.reduce(
    (acc, [, snap]) => {
      const value = (snap.px ?? 0) * (snap.pos ?? 0);
      acc.gross += Math.abs(value);
      acc.net += value;
      acc.pnl += snap.pnl ?? 0;
      return acc;
    },
    { gross: 0, net: 0, pnl: 0 }
  );

  const stableBalance = balances.find((entry) => /USD/i.test(entry.asset)) ?? balances[0];
  const totalCash = balances.reduce((sum, entry) => sum + (entry.available ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardDescription>Portfolio</CardDescription>
        <CardTitle className="text-2xl">Account Overview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Net Asset Value" value={`$${formatNumber(nav ?? 0)}`} />
          <Metric label="Unrealized PnL" value={`$${formatNumber(unrealized ?? 0)}`} intent={(unrealized ?? 0) >= 0 ? 'ok' : 'warn'} />
          <Metric label="Gross Exposure" value={`$${formatNumber(exposureTotals.gross)}`} />
          <Metric label="Net Exposure" value={`$${formatNumber(exposureTotals.net)}`} intent={Math.abs(exposureTotals.net) > 0 ? 'info' : undefined} />
        </div>
        <Separator className="bg-border/60" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Cash (all venues)" value={`$${formatNumber(totalCash)}`} />
          <Metric
            label={stableBalance ? `${stableBalance.asset} @ ${stableBalance.venue}` : 'Primary balance'}
            value={stableBalance ? formatNumber(stableBalance.available + stableBalance.locked) : '—'}
          />
          <Metric label="Realized PnL" value={`$${formatNumber(realized ?? 0)}`} intent={(realized ?? 0) >= 0 ? 'ok' : 'warn'} />
        </div>
      </CardContent>
    </Card>
  );
};

const Metric = ({
  label,
  value,
  intent
}: {
  label: string;
  value: string;
  intent?: 'ok' | 'warn' | 'info';
}) => (
  <div className="rounded-md border border-border/50 bg-background/40 p-3">
    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
    <p
      className={cn(
        'text-lg font-semibold text-foreground',
        intent === 'ok' && 'text-emerald-400',
        intent === 'warn' && 'text-rose-400'
      )}
    >
      {value}
    </p>
  </div>
);
