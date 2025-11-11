import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { StrategyMetrics, StrategyRuntimeStatus } from '../types';
import type { StrategyOption } from '../hooks/useStrategySelection';

interface StrategyMixerCardProps {
  rows: StrategyRuntimeStatus[];
  selectedStrategyId: string;
  onSelect: (id: string) => void;
  options: StrategyOption[];
  focusLabel: string;
  aggregatedMetrics: StrategyMetrics;
  selectedStrategy: StrategyRuntimeStatus | null;
  formatAgo: (ts: number | null | undefined) => string;
}

const metricHighlights = (metrics: StrategyMetrics) => [
  { label: 'Signals', value: metrics.signals.toString(), hint: 'emitted', format: 'text' as const },
  {
    label: 'Intents',
    value: metrics.intents.toString(),
    hint: 'post-budget',
    format: 'text' as const,
  },
  { label: 'Orders', value: metrics.orders.toString(), hint: 'submitted', format: 'text' as const },
  {
    label: 'Fills',
    value: metrics.fills.toString(),
    hint: 'acknowledged',
    format: 'text' as const,
  },
  {
    label: 'Rejects',
    value: metrics.rejects.toString(),
    hint: 'risk/execution',
    format: 'text' as const,
  },
  { label: 'Last Signal', value: metrics.lastSignalTs ?? null, format: 'time' as const },
  { label: 'Last Order', value: metrics.lastOrderTs ?? null, format: 'time' as const },
  { label: 'Last Fill', value: metrics.lastFillTs ?? null, format: 'time' as const },
];

const formatFeeSummary = (fees?: StrategyRuntimeStatus['fees']) => {
  if (!fees) return '—';
  const maker = fees.makerBps ?? null;
  const taker = fees.takerBps ?? null;
  if (maker == null && taker == null) return '—';
  const makerText = maker == null ? '—' : `${maker} bps`;
  const takerText = taker == null ? '—' : `${taker} bps`;
  return `${makerText} / ${takerText}`;
};

export const StrategyMixerCard = ({
  rows,
  selectedStrategyId,
  onSelect,
  options,
  focusLabel,
  aggregatedMetrics,
  selectedStrategy,
  formatAgo,
}: StrategyMixerCardProps) => {
  const highlights = metricHighlights(aggregatedMetrics);

  return (
    <Card className="border-border/60 bg-card/70">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardDescription>Strategy Mixer</CardDescription>
          <CardTitle className="text-2xl">Orchestration</CardTitle>
          <p className="text-xs text-muted-foreground">Focus: {focusLabel}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={selectedStrategyId} onValueChange={onSelect}>
            <SelectTrigger className="w-60 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <SelectValue placeholder="Select strategy" />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedStrategy ? (
            <Badge variant={selectedStrategy.mode === 'live' ? 'default' : 'outline'}>
              {selectedStrategy.mode === 'live' ? 'Live' : 'Sandbox'}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              {highlights.map((metric) => {
                const content =
                  metric.format === 'time'
                    ? formatAgo(metric.value as number | null)
                    : (metric.value as string);
                return (
                  <div
                    key={metric.label}
                    className="rounded-lg border border-border/40 bg-background/40 p-3"
                  >
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {metric.label}
                    </p>
                    <p className="text-2xl font-semibold text-foreground">{content}</p>
                    {metric.hint ? (
                      <p className="text-xs text-muted-foreground/80">{metric.hint}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategy</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Fees (maker / taker)</TableHead>
                    <TableHead className="text-right">Priority</TableHead>
                    <TableHead className="text-right">Signals</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Fills</TableHead>
                    <TableHead className="text-right">Last Signal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((strategy) => {
                    const isSelected = selectedStrategy?.id === strategy.id;
                    return (
                      <TableRow
                        key={strategy.id}
                        className={cn('cursor-pointer', isSelected ? 'bg-primary/5' : undefined)}
                        onClick={() => onSelect(strategy.id)}
                      >
                        <TableCell className="font-semibold">{strategy.id}</TableCell>
                        <TableCell>
                          <Badge variant={strategy.mode === 'live' ? 'default' : 'outline'}>
                            {strategy.mode}
                          </Badge>
                        </TableCell>
                        <TableCell>{strategy.tradeSymbol}</TableCell>
                        <TableCell>{formatFeeSummary(strategy.fees)}</TableCell>
                        <TableCell className="text-right">{strategy.priority}</TableCell>
                        <TableCell className="text-right">
                          {strategy.metrics?.signals ?? 0}
                        </TableCell>
                        <TableCell className="text-right">
                          {strategy.metrics?.orders ?? 0}
                        </TableCell>
                        <TableCell className="text-right">{strategy.metrics?.fills ?? 0}</TableCell>
                        <TableCell className="text-right">
                          {formatAgo(strategy.metrics?.lastSignalTs ?? null)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No strategy telemetry yet — start the trader to stream updates.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
