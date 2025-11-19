import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { StrategyRuntimeStatus } from '../types';

interface PositionRow {
  symbol: string;
  venue: string;
  pos: number;
  avgPx: number;
  px: number;
  value: number;
  notional: number;
  pnl: number;
  realized: number;
  unrealized: number;
}

interface PositionsCardProps {
  rows: PositionRow[];
  totalSymbols: number;
  selectedStrategy: StrategyRuntimeStatus | null;
  formatNumber: (value: number | null | undefined, precision?: number) => string;
}

export const PositionsCard = ({
  rows,
  totalSymbols,
  selectedStrategy,
  formatNumber
}: PositionsCardProps) => {
  const qtyTone = (qty: number) => {
    if (qty > 0) return 'text-emerald-400';
    if (qty < 0) return 'text-rose-400';
    return 'text-muted-foreground';
  };

  const filterLabel = selectedStrategy ? `${selectedStrategy.id}` : 'All';
  
  return (
    <Card className="h-full flex flex-col border-0 shadow-none bg-transparent">
      <div className="flex items-center justify-between px-1 pb-2 border-b border-border/40 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Positions</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">
            {rows.length}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
           {selectedStrategy ? `Strategy: ${filterLabel}` : 'All Strategies'}
        </span>
      </div>
      
      <div className="flex-1 overflow-auto min-h-0 -mx-1">
        {rows.length ? (
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow className="hover:bg-transparent border-b border-border/40">
                <TableHead className="h-7 text-[10px] uppercase">Sym</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">Qty</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">Px</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">Notional</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">PnL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.venue}-${row.symbol}`} className="border-b border-border/20 hover:bg-muted/30">
                  <TableCell className="py-1 font-medium text-xs">
                    <div className="flex flex-col">
                      <span>{row.symbol}</span>
                      <span className="text-[9px] text-muted-foreground uppercase">{row.venue}</span>
                    </div>
                  </TableCell>
                  <TableCell className={cn('py-1 text-right font-mono text-xs', qtyTone(row.pos))}>
                    {formatNumber(row.pos, 4)}
                  </TableCell>
                  <TableCell className="py-1 text-right font-mono text-xs text-muted-foreground">
                    {formatNumber(row.px)}
                  </TableCell>
                  <TableCell className="py-1 text-right font-mono text-xs">
                    {formatNumber(row.notional)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'py-1 text-right font-mono text-xs',
                      (row.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    )}
                  >
                    {formatNumber(row.pnl)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            No open positions
          </div>
        )}
      </div>
    </Card>
  );
};
