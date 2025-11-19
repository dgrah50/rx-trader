import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { StrategyRuntimeStatus, StrategyMarginInfo } from '../types';
import type { StrategyOption } from '../hooks/useStrategySelection';

interface StrategyDetailsCardProps {
  selectedStrategy: StrategyRuntimeStatus | null;
  fallbackStrategy?: {
    type: string;
    tradeSymbol: string;
    primaryFeed: string;
    extraFeeds: string[];
    params?: Record<string, unknown>;
    fees?: {
      makerBps: number;
      takerBps: number;
      source?: string;
    };
    margin?: StrategyMarginInfo;
  } | null;
  persistence?: {
    driver: string;
    sqlitePath?: string;
  } | null;
  options?: StrategyOption[];
  onSelect?: (id: string) => void;
  selectedStrategyId?: string;
}

const formatList = (items?: string[]) =>
  items && items.length ? items.join(', ') : '—';

const formatParams = (params?: Record<string, unknown>) =>
  JSON.stringify(params ?? {}, null, 2);

const formatFee = (bps?: number) => {
  if (bps == null) return '—';
  const pct = (bps / 100).toFixed(2);
  return `${bps} bps (${pct}%)`;
};

export const StrategyDetailsCard = ({
  selectedStrategy,
  fallbackStrategy,
  persistence,
  options = [],
  onSelect,
  selectedStrategyId,
}: StrategyDetailsCardProps) => {

  const detail = selectedStrategy ?? fallbackStrategy ?? null;
  const title = detail?.type ?? 'Strategy';
  const modeBadge = selectedStrategy ? selectedStrategy.mode : null;
  const params = selectedStrategy?.params ?? fallbackStrategy?.params ?? {};
  const budget = selectedStrategy?.budget;
  const fees = selectedStrategy?.fees ?? fallbackStrategy?.fees;
  const margin = selectedStrategy?.margin ?? fallbackStrategy?.margin;

  const marginLabel = margin?.mode === 'perp'
    ? 'Perp'
    : margin?.mode === 'margin'
      ? 'Spot margin'
      : 'Cash spot';


  return (
    <Card className="h-full flex flex-col border-0 shadow-none bg-transparent">
      <div className="flex items-center justify-between px-1 pb-2 border-b border-border/40 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Strategy Details</span>
          {modeBadge && (
            <Badge variant={modeBadge === 'live' ? 'default' : 'outline'} className="h-4 text-[9px] px-1">
              {modeBadge}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {options.length > 0 && onSelect ? (
            <Select value={selectedStrategyId} onValueChange={onSelect}>
              <SelectTrigger className="h-5 w-32 text-[10px] bg-background/50 border-border/50">
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
          ) : (
            <span className="text-[10px] text-muted-foreground font-mono">{title}</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 space-y-3 p-1">

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground uppercase">Symbol</span>
            <span className="font-medium">{detail?.tradeSymbol ?? '—'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground uppercase">Primary Feed</span>
            <span className="font-medium">{detail?.primaryFeed ?? '—'}</span>
          </div>
          <div className="col-span-2 flex flex-col">
            <span className="text-[10px] text-muted-foreground uppercase">Extra Feeds</span>
            <span className="font-medium truncate" title={formatList(detail?.extraFeeds)}>{formatList(detail?.extraFeeds)}</span>
          </div>
        </div>

        {budget && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Budget</p>
            <div className="grid grid-cols-2 gap-2 rounded-sm border border-border/40 bg-card/30 p-2 text-xs">
              <div>
                <span className="text-muted-foreground block text-[10px]">Notional</span>
                <span className="font-mono">{budget.notional ? `$${budget.notional.toLocaleString()}` : '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Max Pos</span>
                <span className="font-mono">{budget.maxPosition ?? '—'}</span>
              </div>
              {budget.throttle && (
                <div className="col-span-2">
                  <span className="text-muted-foreground block text-[10px]">Throttle</span>
                  <span className="font-mono">{budget.throttle.maxCount} / {budget.throttle.windowMs}ms</span>
                </div>
              )}
            </div>
          </div>
        )}

        {fees && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Fees</p>
            <div className="grid grid-cols-3 gap-2 rounded-sm border border-border/40 bg-card/30 p-2 text-xs">
              <div>
                <span className="text-muted-foreground block text-[10px]">Maker</span>
                <span className="font-mono">{formatFee(fees.makerBps)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Taker</span>
                <span className="font-mono">{formatFee(fees.takerBps)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Source</span>
                <span>{fees.source ? fees.source.toUpperCase() : '—'}</span>
              </div>
            </div>
          </div>
        )}

        {margin && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Margin</p>
            <div className="grid grid-cols-3 gap-2 rounded-sm border border-border/40 bg-card/30 p-2 text-xs">
              <div>
                <span className="text-muted-foreground block text-[10px]">Mode</span>
                <span className="capitalize">{marginLabel}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Product</span>
                <span>{margin.productType}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Lev Cap</span>
                <span className="font-mono">{margin.leverageCap.toFixed(2)}×</span>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Params</p>
          <pre className="max-h-32 overflow-y-auto rounded-sm border border-border/40 bg-muted/30 p-2 text-[10px] font-mono">
            {formatParams(params)}
          </pre>
        </div>

        <div className="text-[10px] text-muted-foreground border-t border-border/40 pt-2">
          Persistence: <span className="font-mono">{persistence?.driver ?? '—'}</span>
          {persistence?.driver === 'sqlite' && persistence.sqlitePath
            ? <span className="font-mono block truncate" title={persistence.sqlitePath}>{persistence.sqlitePath}</span>
            : ''}
        </div>
      </div>
    </Card>
  );
};
