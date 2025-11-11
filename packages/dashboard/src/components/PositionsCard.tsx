import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { StrategyRuntimeStatus } from '../types';

interface PositionSnapshot {
  pos: number;
  avgPx: number;
  px: number;
  pnl: number;
}

interface PositionsCardProps {
  positions: Array<[string, PositionSnapshot]>;
  totalSymbols: number;
  selectedStrategy: StrategyRuntimeStatus | null;
  formatNumber: (value: number | null | undefined, precision?: number) => string;
}

export const PositionsCard = ({
  positions,
  totalSymbols,
  selectedStrategy,
  formatNumber
}: PositionsCardProps) => {
  const filterLabel = selectedStrategy ? `${selectedStrategy.id} (${selectedStrategy.tradeSymbol})` : null;
  const totals = positions.reduce(
    (acc, [, snap]) => {
      const value = (snap.px ?? 0) * (snap.pos ?? 0);
      acc.gross += Math.abs(value);
      acc.net += value;
      acc.pnl += snap.pnl ?? 0;
      return acc;
    },
    { gross: 0, net: 0, pnl: 0 }
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div>
          <CardDescription>Positions</CardDescription>
          <CardTitle className="text-xl">Exposure</CardTitle>
        </div>
        <div className="text-xs text-muted-foreground">
          {selectedStrategy
            ? `Filtered to ${filterLabel} · ${positions.length} symbols`
            : `Updated every 6s · ${totalSymbols} symbols`}
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Gross Exposure</p>
            <p className="font-semibold text-foreground">${formatNumber(totals.gross)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Net Exposure</p>
            <p className="font-semibold text-foreground">${formatNumber(totals.net)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Position PnL</p>
            <p className={cn('font-semibold', totals.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
              ${formatNumber(totals.pnl)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {positions.length ? (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Avg Px</TableHead>
                  <TableHead className="text-right">Last Px</TableHead>
                  <TableHead className="text-right">Value ($)</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map(([symbol, snap]) => (
                  <TableRow key={symbol}>
                    <TableCell className="font-semibold">{symbol}</TableCell>
                    <TableCell className="text-right">{formatNumber(snap.pos, 4)}</TableCell>
                    <TableCell className="text-right">{formatNumber(snap.avgPx)}</TableCell>
                    <TableCell className="text-right">{formatNumber(snap.px)}</TableCell>
                    <TableCell className="text-right">{formatNumber(snap.pos * snap.px)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right text-sm font-semibold',
                        (snap.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      )}
                    >
                      {formatNumber(snap.pnl)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {selectedStrategy ? `No exposure for ${selectedStrategy.tradeSymbol}.` : 'No open positions.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
