import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { FeedHealthSnapshot, StrategyRuntimeStatus } from '../types';

interface StrategyHealthCardProps {
  strategies: StrategyRuntimeStatus[];
  feeds: FeedHealthSnapshot[];
  formatNumber: (value: number | null | undefined, precision?: number) => string;
  formatAgo: (value: number | null | undefined) => string;
}

const toneForStatus = (status: string) => {
  if (status === 'connected') return 'text-emerald-400';
  if (status === 'connecting') return 'text-amber-400';
  return 'text-rose-400';
};

export const StrategyHealthCard = ({
  strategies,
  feeds,
  formatNumber,
  formatAgo
}: StrategyHealthCardProps) => {
  const healthRows = strategies.map((strategy) => {
    const metrics = (strategy.metrics ?? {}) as {
      signals?: number;
      intents?: number;
      orders?: number;
      fills?: number;
      rejects?: number;
      lastSignalTs?: number | null;
      lastIntentTs?: number | null;
    };
    const signalGap = (metrics.signals ?? 0) - (metrics.intents ?? 0);
    const lastSignal = metrics.lastSignalTs ?? null;
    const lastIntent = metrics.lastIntentTs ?? null;
    return {
      id: strategy.id,
      symbol: strategy.tradeSymbol,
      type: strategy.type,
      signals: metrics.signals ?? 0,
      intents: metrics.intents ?? 0,
      signalGap,
      orders: metrics.orders ?? 0,
      fills: metrics.fills ?? 0,
      rejects: metrics.rejects ?? 0,
      lastSignal,
      lastIntent
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardDescription>Strategy Health</CardDescription>
        <CardTitle className="text-xl">Signal &amp; Intent Flow</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm font-semibold">Signals vs intents</p>
          {healthRows.length ? (
            <div className="overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategy</TableHead>
                    <TableHead>Signals</TableHead>
                    <TableHead>Intents</TableHead>
                    <TableHead>Gap</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Fills</TableHead>
                    <TableHead>Rejects</TableHead>
                    <TableHead>Last Signal</TableHead>
                    <TableHead>Last Intent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {healthRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-semibold">{row.symbol}</TableCell>
                      <TableCell className="font-mono">{formatNumber(row.signals, 0)}</TableCell>
                      <TableCell className="font-mono">{formatNumber(row.intents, 0)}</TableCell>
                      <TableCell
                        className={cn('font-mono', row.signalGap <= 0 ? 'text-emerald-400' : 'text-rose-400')}
                      >
                        {row.signalGap}
                      </TableCell>
                      <TableCell className="font-mono">{formatNumber(row.orders, 0)}</TableCell>
                      <TableCell className="font-mono">{formatNumber(row.fills, 0)}</TableCell>
                      <TableCell className="font-mono text-rose-400">{formatNumber(row.rejects, 0)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatAgo(row.lastSignal)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatAgo(row.lastIntent)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No strategy telemetry available.</p>
          )}
        </div>

        <div>
          <p className="text-sm font-semibold">Feed health</p>
          {feeds.length ? (
            <div className="overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Tick</TableHead>
                    <TableHead>Reconnects</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feeds.map((feed) => (
                    <TableRow key={feed.id}>
                      <TableCell className="font-semibold">{feed.id}</TableCell>
                      <TableCell className={toneForStatus(feed.status)}>{feed.status}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatAgo(feed.lastTickTs)}
                      </TableCell>
                      <TableCell className="font-mono">{formatNumber(feed.reconnects, 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No feeds available.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
