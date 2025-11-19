import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { BalanceEntry, BalanceSyncTelemetry } from '../types';
import { formatAgo, formatNumber } from '../lib/format';

interface AccountBalancesCardProps {
  balances: Array<BalanceEntry & { venue: string }>;
  updated: number | null;
  balanceSync?: BalanceSyncTelemetry | null;
}

export const AccountBalancesCard = ({ balances, updated, balanceSync }: AccountBalancesCardProps) => (
  <Card className="h-full flex flex-col border-0 shadow-none bg-transparent">
    <div className="flex items-center justify-between px-1 pb-2 border-b border-border/40 mb-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Balances</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">
          {balances.length}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground text-right">
        <div>Updated {formatAgo(updated)}</div>
        {balanceSync && (
          <div className="text-muted-foreground/60">
            Sync: {formatAgo(balanceSync.lastSuccessMs ?? null)} ({balanceSync.provider})
          </div>
        )}
      </div>
    </div>

    <div className="flex-1 overflow-auto min-h-0 -mx-1">
      {balanceSync?.lastError ? (
        <p className="mb-2 px-1 text-[10px] text-amber-500">Sync error: {balanceSync.lastError.message}</p>
      ) : null}
      {balances.length ? (
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow className="hover:bg-transparent border-b border-border/40">
              <TableHead className="h-6 text-[10px] uppercase">Venue</TableHead>
              <TableHead className="h-6 text-[10px] uppercase">Asset</TableHead>
              <TableHead className="h-6 text-[10px] uppercase text-right">Free</TableHead>
              <TableHead className="h-6 text-[10px] uppercase text-right">Lock</TableHead>
              <TableHead className="h-6 text-[10px] uppercase text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {balances.map((row) => (
              <TableRow key={`${row.venue}-${row.asset}`} className="border-b border-border/20 hover:bg-muted/30">
                <TableCell className="py-1 text-xs font-medium">{row.venue}</TableCell>
                <TableCell className="py-1 text-xs font-medium">{row.asset}</TableCell>
                <TableCell className="py-1 text-xs text-right font-mono">{formatNumber(row.available)}</TableCell>
                <TableCell className="py-1 text-xs text-right font-mono text-muted-foreground">{formatNumber(row.locked)}</TableCell>
                <TableCell className="py-1 text-xs text-right font-mono font-medium">{formatNumber(row.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
          No balance events.
        </div>
      )}
    </div>
  </Card>
);
