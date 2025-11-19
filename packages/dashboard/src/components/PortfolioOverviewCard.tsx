import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { BalanceEntry, PositionSnapshot } from '../types';
import { cn } from '@/lib/utils';

interface PortfolioOverviewProps {
  nav: number | null | undefined;
  netRealized: number | null | undefined;
  grossRealized: number | null | undefined;
  unrealized: number | null | undefined;
  feesPaid: number | null | undefined;
  positions: Array<[string, PositionSnapshot]>;
  balances: Array<BalanceEntry & { venue: string }>;
  formatNumber: (value: number | null | undefined, precision?: number) => string;
}

export const PortfolioOverviewCard = ({
  nav,
  netRealized,
  grossRealized,
  unrealized,
  feesPaid,
  positions,
  balances,
  formatNumber,
}: PortfolioOverviewProps) => {
  const exposureTotals = positions.reduce(
    (acc, [, snap]) => {
      const value = (snap.px ?? 0) * (snap.pos ?? 0);
      acc.gross += Math.abs(value);
      acc.net += value;
      acc.pnl += snap.pnl ?? 0;
      return acc;
    },
    { gross: 0, net: 0, pnl: 0 },
  );

  const stableBalance = balances.find((entry) => /USD/i.test(entry.asset)) ?? balances[0];
  const totalCash = balances.reduce((sum, entry) => sum + (entry.available ?? 0), 0);

  const formatCurrency = (val: number | undefined | null) => `$${formatNumber(val ?? 0)}`;

  return (
    <div className="flex items-center gap-6 px-3 py-2 bg-card/30 border-b border-border/50">
      <Metric
        label="NAV"
        value={formatCurrency(nav)}
      />
      <Separator orientation="vertical" className="h-8" />
      <Metric
        label="Net PnL"
        value={formatCurrency(netRealized)}
        trend={(netRealized ?? 0) >= 0 ? 'up' : 'down'}
      />
      <Separator orientation="vertical" className="h-8" />
      <Metric
        label="Unrealized"
        value={formatCurrency(unrealized)}
        trend={(unrealized ?? 0) >= 0 ? 'up' : 'down'}
      />
      <Separator orientation="vertical" className="h-8" />
      <Metric
        label="Fees"
        value={formatCurrency(feesPaid)}
        trend="down"
      />
      <Separator orientation="vertical" className="h-8" />
      <Metric
        label="Cash"
        value={formatCurrency(totalCash)}
      />
      <Separator orientation="vertical" className="h-8" />
      <Metric
        label="Gross Exp"
        value={formatCurrency(exposureTotals.gross)}
      />
      <Separator orientation="vertical" className="h-8" />
      <Metric
        label="Net Exp"
        value={formatCurrency(exposureTotals.net)}
      />
      <Separator orientation="vertical" className="h-8" />
      <Metric
        label="Gross PnL"
        value={formatCurrency(grossRealized)}
        trend={(grossRealized ?? 0) >= 0 ? 'up' : 'down'}
      />
    </div>
  );
};

interface MetricProps {
  label: string;
  value: string;
  subValue?: string;
  trend?: 'up' | 'down';
  className?: string;
}

const Metric = ({ label, value, subValue, trend, className }: MetricProps) => (
  <div className={cn("flex flex-col gap-0.5", className)}>
    <span className="text-[10px] text-muted-foreground/70 leading-none">{label}</span>
    <div className="flex items-baseline gap-1">
      <span className={cn(
        "text-sm font-mono font-semibold leading-none tracking-tight",
        trend === 'up' && "text-up",
        trend === 'down' && "text-down",
        !trend && "text-foreground"
      )}>
        {value}
      </span>
      {subValue && (
        <span className="text-[9px] text-muted-foreground/50 font-mono leading-none">{subValue}</span>
      )}
    </div>
  </div>
);
