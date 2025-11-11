import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { StrategyRuntimeStatus, StrategyMarginInfo } from '../types';

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
  persistence
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
    <Card>
      <CardHeader>
        <CardDescription>Strategy Details</CardDescription>
        <CardTitle className="text-xl flex items-center gap-2">
          {title}
          {modeBadge ? <Badge variant={modeBadge === 'live' ? 'default' : 'outline'}>{modeBadge}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Symbol</span>
          <span className="font-semibold">{detail?.tradeSymbol ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Primary Feed</span>
          <span className="font-semibold">{detail?.primaryFeed ?? '—'}</span>
        </div>
        <div>
          <p className="text-muted-foreground">Extra Feeds</p>
          <p className="font-semibold">{formatList(detail?.extraFeeds)}</p>
        </div>
        {budget ? (
          <div className="grid gap-2 rounded-md border border-border/60 p-2 text-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Notional</span>
              <span className="font-semibold text-foreground">
                {budget.notional ? `$${budget.notional.toLocaleString()}` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Max Position</span>
              <span className="font-semibold text-foreground">
                {budget.maxPosition ?? '—'}
              </span>
            </div>
            {budget.throttle ? (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Throttle</span>
                <span className="font-semibold text-foreground">
                  {budget.throttle.maxCount} / {budget.throttle.windowMs}ms
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        {fees ? (
          <div className="grid gap-2 rounded-md border border-border/60 p-2 text-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Maker Fee</span>
              <span className="font-semibold text-foreground">{formatFee(fees.makerBps)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Taker Fee</span>
              <span className="font-semibold text-foreground">{formatFee(fees.takerBps)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Source</span>
              <span className="font-semibold text-foreground">
                {fees.source ? fees.source.toUpperCase() : '—'}
              </span>
            </div>
          </div>
        ) : null}
        {margin ? (
          <div className="grid gap-2 rounded-md border border-border/60 p-2 text-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Market Mode</span>
              <span className="font-semibold text-foreground capitalize">{marginLabel}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Product</span>
              <span className="font-semibold text-foreground">{margin.productType}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Leverage Cap</span>
              <span className="font-semibold text-foreground">{margin.leverageCap.toFixed(2)}×</span>
            </div>
          </div>
        ) : null}
        <div>
          <p className="text-muted-foreground">Params</p>
          <pre className="mt-1 max-h-32 overflow-y-auto rounded-md bg-muted/40 p-2 text-xs">
            {formatParams(params)}
          </pre>
        </div>
        <div className="text-xs text-muted-foreground">
          Persistence: {persistence?.driver ?? '—'}
          {persistence?.driver === 'sqlite' && persistence.sqlitePath
            ? ` · ${persistence.sqlitePath}`
            : ''}
        </div>
      </CardContent>
    </Card>
  );
};
