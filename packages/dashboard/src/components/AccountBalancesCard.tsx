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
  <Card>
    <CardHeader className="flex flex-col gap-2">
      <div>
        <CardDescription>Account</CardDescription>
        <CardTitle className="text-xl">Balances</CardTitle>
      </div>
      <div className="text-xs text-muted-foreground">
        {balances.length} holdings · Updated {formatAgo(updated)}
        {balanceSync ? (
          <span className="block text-muted-foreground/80">
            Last sync {formatAgo(balanceSync.lastSuccessMs ?? null)} via {balanceSync.provider}
          </span>
        ) : null}
      </div>
    </CardHeader>
    <CardContent>
      {balanceSync?.lastError ? (
        <p className="mb-2 text-xs text-amber-500">Balance sync error: {balanceSync.lastError.message}</p>
      ) : null}
      {balances.length ? (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venue</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Locked</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((row) => (
                <TableRow key={`${row.venue}-${row.asset}`}>
                  <TableCell className="font-semibold">{row.venue}</TableCell>
                  <TableCell>{row.asset}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.available)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.locked)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No balance events recorded yet.</p>
      )}
    </CardContent>
  </Card>
);
