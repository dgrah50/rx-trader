import { AlertTriangle, BarChart3, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { StreamStatus } from '../hooks';
import { formatAgo, formatNumber } from '../lib/format';
import type { FeedHealthSnapshot } from '../types';

const ConnectionDot = ({ status }: { status: StreamStatus }) => {
  const color =
    status === 'open'
      ? 'text-emerald-400'
      : status === 'connecting'
        ? 'text-amber-400'
        : 'text-rose-400';
  return <span className={`inline-flex h-2.5 w-2.5 rounded-full ${color} bg-current`} />;
};

const StatusBadge = ({ label, intent }: { label: string; intent?: 'ok' | 'warn' | 'error' }) => {
  const variants = {
    ok: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    error: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  } as const;
  return (
    <Badge variant="outline" className={intent ? variants[intent] : undefined}>
      {label}
    </Badge>
  );
};

interface StatusHeaderProps {
  modeLabel: string;
  modeIntent: 'ok' | 'warn';
  feedSummary: { total: number; connected: number; stale: number };
  feeds: FeedHealthSnapshot[];
  lastEventTs: number | null;
  lastLogTs: number | null;
  killSwitch: boolean;
  eventStreamStatus: StreamStatus;
  logStreamStatus: StreamStatus;
  showWarning: boolean;
  onOpenControl: () => void;
  onOpenMetrics: () => void;
  marginSnapshot?: {
    used: number;
    available: number;
  } | null;
}

export const StatusHeader = ({
  modeLabel,
  modeIntent,
  feedSummary,
  feeds,
  lastEventTs,
  lastLogTs,
  killSwitch,
  eventStreamStatus,
  logStreamStatus,
  showWarning,
  onOpenControl,
  onOpenMetrics,
  marginSnapshot,
}: StatusHeaderProps) => {
  const formatCurrency = (value: number) => `$${formatNumber(value, value >= 1000 ? 0 : 2)}`;
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between w-full">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className={cn("font-bold uppercase tracking-wider", modeIntent === 'ok' ? 'text-emerald-500' : 'text-amber-500')}>
            {modeLabel}
          </span>
          <div className="h-3 w-px bg-border" />
        </div>
        
        <FeedStatusTooltip feeds={feeds}>
          <div className="flex items-center gap-1.5 cursor-help hover:text-foreground transition-colors text-muted-foreground">
            <div className={cn("h-1.5 w-1.5 rounded-full", feedSummary.connected === feedSummary.total ? "bg-emerald-500" : "bg-amber-500")} />
            <span>Feeds {feedSummary.connected}/{feedSummary.total}</span>
          </div>
        </FeedStatusTooltip>

        {marginSnapshot && (
          <>
            <div className="h-3 w-px bg-border" />
            <span className="text-muted-foreground">
              Margin: <span className="text-foreground font-mono">{formatCurrency(marginSnapshot.used)}</span> used <span className="text-muted-foreground">/</span> <span className="text-foreground font-mono">{formatCurrency(marginSnapshot.available)}</span> free
            </span>
          </>
        )}

        <div className="h-3 w-px bg-border" />
        <span className="text-muted-foreground">
          Event: <span className="text-foreground font-mono">{formatAgo(lastEventTs)}</span>
        </span>
        <span className="text-muted-foreground">
          Log: <span className="text-foreground font-mono">{formatAgo(lastLogTs)}</span>
        </span>

        {killSwitch && (
          <Badge variant="destructive" className="h-5 text-[10px] px-1.5 uppercase">
            Kill Switch Active
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs">
        {showWarning && (
          <span className="flex items-center gap-1.5 text-amber-500 font-medium animate-pulse">
            <AlertTriangle className="h-3 w-3" /> Reconnecting...
          </span>
        )}
        
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="flex items-center gap-1.5" title="Event Stream">
            <ConnectionDot status={eventStreamStatus} />
            <span className="hidden sm:inline">Events</span>
          </div>
          <div className="flex items-center gap-1.5" title="Log Stream">
            <ConnectionDot status={logStreamStatus} />
            <span className="hidden sm:inline">Logs</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={onOpenControl}>
            <Link2 className="mr-1.5 h-3 w-3" /> Control
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={onOpenMetrics}>
            <BarChart3 className="mr-1.5 h-3 w-3" /> Metrics
          </Button>
        </div>
      </div>
    </div>
  );
};

const FeedStatusTooltip = ({
  feeds,
  children,
}: {
  feeds: FeedHealthSnapshot[];
  children: React.ReactNode;
}) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="min-w-[220px]">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">Feed health</p>
        {feeds.length ? (
          <div className="space-y-2 text-xs">
            {feeds.map((feed) => (
              <div key={feed.id} className="flex items-center justify-between gap-4">
                <span className="font-semibold text-foreground">{feed.id}</span>
                <span className="text-muted-foreground">
                  {feed.status}
                  {typeof feed.ageSeconds === 'number' ? ` · ${feed.ageSeconds.toFixed(1)}s` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No feed telemetry yet.</p>
        )}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
