import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
    ? `Filtered to ${selectedStrategy.id} (${selectedStrategy.tradeSymbol})`
    : `Last ${orders.length} events`;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2">
        <div>
          <CardDescription>Orders</CardDescription>
          <CardTitle className="text-xl">Recent Activity</CardTitle>
        </div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </CardHeader>
      <CardContent>
        {orders.length ? (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Side</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Px</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(order.ts).toLocaleTimeString()}
                    </TableCell>
                    <TableCell className="font-semibold">{order.type.replace('order.', '')}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {order.summary.strategyId ?? '—'}
                    </TableCell>
                    <TableCell>{order.summary.symbol}</TableCell>
                    <TableCell className="text-right">{order.summary.side || '—'}</TableCell>
                    <TableCell className="text-right">
                      {order.summary.qty == null ? '—' : formatNumber(order.summary.qty, 4)}
                    </TableCell>
                    <TableCell className="text-right">
                      {order.summary.px == null ? '—' : formatNumber(order.summary.px, 2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {selectedStrategy
              ? `No order activity for ${selectedStrategy.id}.`
              : 'No order activity yet.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
