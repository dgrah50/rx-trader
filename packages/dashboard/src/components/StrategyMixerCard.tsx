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
    <Card className="h-full flex flex-col border-0 shadow-none bg-transparent">
      <div className="flex flex-col gap-2 border-b border-border/40 pb-2 mb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Strategy Mixer</span>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedStrategyId} onValueChange={onSelect}>
              <SelectTrigger className="h-6 w-48 text-xs bg-background/50 border-border/50">
                <SelectValue placeholder="Select strategy" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedStrategy && (
              <Badge variant={selectedStrategy.mode === 'live' ? 'default' : 'outline'} className="h-5 text-[10px] px-1.5">
                {selectedStrategy.mode === 'live' ? 'Live' : 'Sandbox'}
              </Badge>
            )}
          </div>
        </div>
        
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {highlights.map((metric) => {
              const content =
                metric.format === 'time'
                  ? formatAgo(metric.value as number | null)
                  : (metric.value as string);
              return (
                <div 
                  key={metric.label} 
                  className="flex flex-col px-2 py-1 rounded-sm border bg-card/50 min-w-[70px] flex-1 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    // The original code had `onSelect(row.id)` here, but `row` is not defined in this scope.
                    // This onClick handler is for a metric highlight, not a strategy row.
                    // If the intention was to select the currently selected strategy, it would be:
                    // if (selectedStrategy) onSelect(selectedStrategy.id);
                    // For now, removing the erroneous call to avoid runtime errors.
                  }}
                >
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{metric.label}</span>
                  <span className="text-xs font-mono font-medium">{content}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto min-h-0 -mx-1">
        {rows.length ? (
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow className="hover:bg-transparent border-b border-border/40">
                <TableHead className="h-7 text-[10px] uppercase">Strategy</TableHead>
                <TableHead className="h-7 text-[10px] uppercase">Mode</TableHead>
                <TableHead className="h-7 text-[10px] uppercase">Sym</TableHead>
                <TableHead className="h-7 text-[10px] uppercase">Fees (M/T)</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">Pri</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">Sig</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">Ord</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">Fil</TableHead>
                <TableHead className="h-7 text-[10px] uppercase text-right">Last Sig</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((strategy) => {
                const isSelected = selectedStrategy?.id === strategy.id;
                return (
                  <TableRow
                    key={strategy.id}
                    className={cn('cursor-pointer border-b border-border/20 hover:bg-muted/30', isSelected ? 'bg-primary/5' : undefined)}
                    onClick={() => onSelect(strategy.id)}
                  >
                    <TableCell className="py-1 text-xs font-medium">{strategy.id}</TableCell>
                    <TableCell className="py-1 text-xs">
                      <span className={cn("text-[10px] px-1 rounded-sm border", strategy.mode === 'live' ? 'border-emerald-500/30 text-emerald-500' : 'border-muted-foreground/30 text-muted-foreground')}>
                        {strategy.mode}
                      </span>
                    </TableCell>
                    <TableCell className="py-1 text-xs">{strategy.tradeSymbol}</TableCell>
                    <TableCell className="py-1 text-xs text-muted-foreground">{formatFeeSummary(strategy.fees)}</TableCell>
                    <TableCell className="py-1 text-xs text-right">{strategy.priority}</TableCell>
                    <TableCell className="py-1 text-xs text-right font-mono">{strategy.metrics?.signals ?? 0}</TableCell>
                    <TableCell className="py-1 text-xs text-right font-mono">{strategy.metrics?.orders ?? 0}</TableCell>
                    <TableCell className="py-1 text-xs text-right font-mono">{strategy.metrics?.fills ?? 0}</TableCell>
                    <TableCell className="py-1 text-xs text-right text-muted-foreground">{formatAgo(strategy.metrics?.lastSignalTs ?? null)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            No strategy telemetry yet.
          </div>
        )}
      </div>
    </Card>
  );
};
