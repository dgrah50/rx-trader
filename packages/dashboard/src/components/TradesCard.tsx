import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ClosedTrade, OpenTrade, TradeDirection } from '../types';

interface TradesCardProps {
  openTrades: OpenTrade[];
  closedTrades: ClosedTrade[];
  formatNumber: (value: number | null | undefined, precision?: number) => string;
  formatAgo: (value: number | null | undefined) => string;
}

const renderPnl = (value: number, formatNumber: (v: number | null | undefined, precision?: number) => string) => (
  <span className={cn('font-semibold', value >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
    ${formatNumber(value)}
  </span>
);

const directionTone = (direction: TradeDirection) => {
  if (direction === 'LONG') return 'text-sky-300';
  if (direction === 'SHORT') return 'text-amber-300';
  return '';
};

export const TradesCard = ({ openTrades, closedTrades, formatNumber, formatAgo }: TradesCardProps) => {
  const latestClosed = closedTrades.slice(0, 10);

  return (
    <Card className="h-full flex flex-col border-0 shadow-none bg-transparent">
      <div className="flex items-center justify-between px-1 pb-2 border-b border-border/40 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trades</span>
      </div>
      
      <div className="flex-1 overflow-auto min-h-0 -mx-1 flex flex-col gap-4">
        <div>
          <div className="px-1 mb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Open Positions</div>
          {openTrades.length ? (
            <Table>
              <TableHeader className="bg-background">
                <TableRow className="hover:bg-transparent border-b border-border/40">
                  <TableHead className="h-6 text-[10px] uppercase">Sym</TableHead>
                  <TableHead className="h-6 text-[10px] uppercase">Side</TableHead>
                  <TableHead className="h-6 text-[10px] uppercase text-right">Qty</TableHead>
                  <TableHead className="h-6 text-[10px] uppercase text-right">Entry</TableHead>
                  <TableHead className="h-6 text-[10px] uppercase text-right">Mark</TableHead>
                  <TableHead className="h-6 text-[10px] uppercase text-right">PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openTrades.map((trade) => (
                  <TableRow key={`${trade.symbol}-${trade.entryTs}`} className="border-b border-border/20 hover:bg-muted/30">
                    <TableCell className="py-1 text-xs font-medium">{trade.symbol}</TableCell>
                    <TableCell className={cn('py-1 text-xs font-medium', directionTone(trade.direction))}>
                      {trade.direction}
                    </TableCell>
                    <TableCell className="py-1 text-xs text-right font-mono">{formatNumber(trade.qty, 4)}</TableCell>
                    <TableCell className="py-1 text-xs text-right font-mono">{formatNumber(trade.entryPx)}</TableCell>
                    <TableCell className="py-1 text-xs text-right font-mono">{formatNumber(trade.markPx)}</TableCell>
                    <TableCell className="py-1 text-xs text-right">
                      {renderPnl(trade.unrealizedPnl, formatNumber)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-1 text-xs text-muted-foreground">No open trades.</p>
          )}
        </div>

        <div>
          <div className="px-1 mb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Recently Closed</div>
          {latestClosed.length ? (
            <Table>
              <TableHeader className="bg-background">
                <TableRow className="hover:bg-transparent border-b border-border/40">
                  <TableHead className="h-6 text-[10px] uppercase">Sym</TableHead>
                  <TableHead className="h-6 text-[10px] uppercase">Side</TableHead>
                  <TableHead className="h-6 text-[10px] uppercase text-right">Qty</TableHead>
                  <TableHead className="h-6 text-[10px] uppercase text-right">Entry</TableHead>
                  <TableHead className="h-6 text-[10px] uppercase text-right">Exit</TableHead>
                  <TableHead className="h-6 text-[10px] uppercase text-right">PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latestClosed.map((trade, idx) => (
                  <TableRow key={`${trade.symbol}-${trade.exitTs}-${idx}`} className="border-b border-border/20 hover:bg-muted/30">
                    <TableCell className="py-1 text-xs font-medium">{trade.symbol}</TableCell>
                    <TableCell className={cn('py-1 text-xs font-medium', directionTone(trade.direction))}>
                      {trade.direction}
                    </TableCell>
                    <TableCell className="py-1 text-xs text-right font-mono">{formatNumber(trade.qty, 4)}</TableCell>
                    <TableCell className="py-1 text-xs text-right font-mono">{formatNumber(trade.entryPx)}</TableCell>
                    <TableCell className="py-1 text-xs text-right font-mono">{formatNumber(trade.exitPx)}</TableCell>
                    <TableCell className="py-1 text-xs text-right">
                      {renderPnl(trade.realizedPnl, formatNumber)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-1 text-xs text-muted-foreground">No closed trades yet.</p>
          )}
        </div>
      </div>
    </Card>
  );
};
