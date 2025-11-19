import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { StrategyRuntimeStatus } from '../types';

interface OrderSummary {
  id: string;
  ts: number;
  type: string;
  summary: {
    symbol: string;
    side: string;
    qty: number | null;
    px: number | null;
    strategyId: string | null;
  };
}

interface OrdersCardProps {
  orders: OrderSummary[];
  selectedStrategy: StrategyRuntimeStatus | null;
  formatNumber: (value: number | null | undefined, precision?: number) => string;
}

export const OrdersCard = ({ orders, selectedStrategy, formatNumber }: OrdersCardProps) => {
  const subtitle = selectedStrategy
    ? `Filtered to ${selectedStrategy.id}`
    : `Last ${orders.length} events`;

  return (
    <Card className="h-full flex flex-col border-0 shadow-none bg-transparent">
      <div className="flex items-center justify-between px-1 pb-2 border-b border-border/40 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Orders</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">
            {orders.length}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">{subtitle}</span>
      </div>
      
      <div className="flex-1 overflow-auto min-h-0 -mx-1">
        {orders.length ? (
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow className="hover:bg-transparent border-b border-border/40">
                <TableHead className="h-7 text-[10px] uppercase">Time</TableHead>
                <TableHead className="h-7 text-[10px] uppercase">Type</TableHead>
                <TableHead className="h-7 text-[10px] uppercase">Sym</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">Side</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">Qty</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">Px</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} className="border-b border-border/20 hover:bg-muted/30">
                  <TableCell className="py-1 text-[10px] text-muted-foreground font-mono">
                    {new Date(order.ts).toLocaleTimeString()}
                  </TableCell>
                  <TableCell className="py-1 text-xs font-medium">
                    {order.type.replace('order.', '')}
                  </TableCell>
                  <TableCell className="py-1 text-xs">{order.summary.symbol}</TableCell>
                  <TableCell className={cn("py-1 text-xs text-right font-medium", order.summary.side === 'Buy' ? 'text-emerald-400' : order.summary.side === 'Sell' ? 'text-rose-400' : '')}>
                    {order.summary.side || '—'}
                  </TableCell>
                  <TableCell className="py-1 text-xs text-right font-mono">
                    {order.summary.qty == null ? '—' : formatNumber(order.summary.qty, 4)}
                  </TableCell>
                  <TableCell className="py-1 text-xs text-right font-mono">
                    {order.summary.px == null ? '—' : formatNumber(order.summary.px, 2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            No order activity yet.
          </div>
        )}
      </div>
    </Card>
  );
};
