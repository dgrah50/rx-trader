import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SummaryTile } from './primitives/SummaryTile';
import type { BacktestArtifact, BacktestHistoryEntry } from '../types';
import { formatNumber, formatPercent } from '../lib/format';
import { Sparkline } from './primitives/Sparkline';

interface BacktestPanelProps {
  artifact: BacktestArtifact | null;
  onArtifactChange: (artifact: BacktestArtifact | null) => void;
  history: BacktestHistoryEntry[];
}

export const BacktestPanel = ({ artifact, onArtifactChange, history }: BacktestPanelProps) => {
  const [backtestUrl, setBacktestUrl] = useState('');

  const loadArtifact = async () => {
    if (!backtestUrl) return;
    const res = await fetch(backtestUrl);
    if (!res.ok) {
      alert(`Failed to load artifact (${res.status})`);
      return;
    }
    onArtifactChange((await res.json()) as BacktestArtifact);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2 h-full">
      <Card className="h-full flex flex-col border-0 shadow-none bg-transparent">
        <div className="flex items-center justify-between px-1 pb-2 border-b border-border/40 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Backtest Publishing</span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 px-1">
          <div className="flex gap-1">
            <Input
              value={backtestUrl}
              onChange={(evt) => setBacktestUrl(evt.target.value)}
              placeholder="https://example.com/artifact.json"
              className="h-6 text-xs font-mono bg-background/50 border-border/50"
            />
            <Button variant="secondary" size="sm" className="h-6 px-2 text-[10px] uppercase tracking-wider" onClick={loadArtifact}>
              Load
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] uppercase tracking-wider" onClick={() => onArtifactChange(null)}>
              Reset
            </Button>
          </div>
          {artifact ? (
            <div className="space-y-2 border border-border/40 bg-card/30 rounded-sm p-2">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-semibold">{artifact.summary.symbol}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {artifact.summary.events} events · {artifact.summary.ticksUsed} ticks
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SummaryTile label="Sharpe" value={formatNumber(artifact.summary.sharpe, 3)} />
                <SummaryTile
                  label="Max DD %"
                  value={formatPercent(artifact.summary.maxDrawdownPct)}
                />
              </div>
              <div className="h-16">
                 <Sparkline values={artifact.navCurve.map((p) => p.nav)} />
              </div>
            </div>
          ) : (
            <div className="flex h-20 items-center justify-center text-[10px] text-muted-foreground border border-dashed border-border/30 rounded-sm">
              Publish via `rx backtest --publish` or load JSON
            </div>
          )}
        </div>
      </Card>

      <Card className="h-full flex flex-col border-0 shadow-none bg-transparent">
        <div className="flex items-center justify-between px-1 pb-2 border-b border-border/40 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">History</span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 px-1">
          {history.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-1 rounded-sm border border-border/30 bg-card/30 p-2 hover:bg-card/50 transition-colors">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="font-mono">{new Date(entry.ts).toLocaleString()}</span>
                <span className="font-medium text-foreground">{entry.summary?.symbol ?? '—'}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="flex flex-col">
                  <span className="text-muted-foreground uppercase tracking-wider text-[9px]">Sharpe</span>
                  <span className="font-mono font-medium">{formatNumber(entry.summary?.sharpe, 2)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground uppercase tracking-wider text-[9px]">Max DD</span>
                  <span className="font-mono font-medium">{formatPercent(Math.abs(entry.summary?.maxDrawdownPct ?? 0))}</span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-muted-foreground uppercase tracking-wider text-[9px]">Runtime</span>
                  <span className="font-mono font-medium">{formatNumber(entry.summary?.runtimeMs ?? 0, 0)}ms</span>
                </div>
              </div>
            </div>
          ))}
          {!history.length && (
            <div className="flex h-20 items-center justify-center text-[10px] text-muted-foreground">
              No artifacts published.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
