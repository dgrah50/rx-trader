import { AlertTriangle, BarChart3, Link2 } from 'lucide-react';
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
    <Card className="border-primary/30">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <CardDescription>Status</CardDescription>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge label={modeLabel} intent={modeIntent} />
            <FeedStatusTooltip feeds={feeds}>
              <StatusBadge
                label={`Feeds ${feedSummary.connected}/${feedSummary.total}`}
                intent={feedSummary.connected ? 'ok' : 'warn'}
              />
            </FeedStatusTooltip>
            {marginSnapshot ? (
              <StatusBadge
                label={`Initial margin ${formatCurrency(marginSnapshot.used)} used / ${formatCurrency(marginSnapshot.available)} free`}
                intent={marginSnapshot.available > 0 ? 'ok' : 'warn'}
              />
            ) : null}
            <span className="text-xs text-muted-foreground">
              Last event {formatAgo(lastEventTs)} · Last log {formatAgo(lastLogTs)}
            </span>
            {killSwitch && <StatusBadge label="Kill switch" intent="error" />}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <ConnectionDot status={eventStreamStatus} />
            <span>Events stream</span>
          </div>
          <div className="flex items-center gap-1">
            <ConnectionDot status={logStreamStatus} />
            <span>Logs stream</span>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onOpenControl}>
              <Link2 className="mr-1 h-3.5 w-3.5" /> Control Plane
            </Button>
            <Button variant="outline" size="sm" onClick={onOpenMetrics}>
              <BarChart3 className="mr-1 h-3.5 w-3.5" /> Metrics
            </Button>
          </div>
        </div>
      </CardHeader>
      {showWarning && (
        <CardContent className="flex items-center gap-2 text-sm text-amber-500">
          <AlertTriangle className="h-4 w-4" /> Live stream degraded — attempting to reconnect.
        </CardContent>
      )}
    </Card>
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
