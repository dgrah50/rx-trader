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
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardDescription>Load Backtest Artifact</CardDescription>
          <CardTitle className="text-lg">Publishing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={backtestUrl}
              onChange={(evt) => setBacktestUrl(evt.target.value)}
              placeholder="https://example.com/artifact.json"
            />
            <Button variant="secondary" onClick={loadArtifact}>
              Load
            </Button>
            <Button variant="ghost" onClick={() => onArtifactChange(null)}>
              Reset
            </Button>
          </div>
          {artifact ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold">{artifact.summary.symbol}</p>
                <p className="text-xs text-muted-foreground">
                  {artifact.summary.events} events · {artifact.summary.ticksUsed} ticks
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <SummaryTile label="Sharpe" value={formatNumber(artifact.summary.sharpe, 3)} />
                <SummaryTile
                  label="Max DD %"
                  value={formatPercent(artifact.summary.maxDrawdownPct)}
                />
              </div>
              <Sparkline values={artifact.navCurve.map((p) => p.nav)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Publish via `rx backtest --publish` or load a JSON file to inspect stats here.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Recent Backtests</CardDescription>
          <CardTitle className="text-lg">History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-border/40 bg-background/40 p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{new Date(entry.ts).toLocaleString()}</span>
                <span>{entry.summary?.symbol ?? '—'}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Sharpe</p>
                  <p className="font-semibold">{formatNumber(entry.summary?.sharpe, 2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Max DD %</p>
                  <p className="font-semibold">
                    {formatPercent(Math.abs(entry.summary?.maxDrawdownPct ?? 0))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Runtime</p>
                  <p className="font-semibold">{formatNumber(entry.summary?.runtimeMs ?? 0, 0)}ms</p>
                </div>
              </div>
            </div>
          ))}
          {!history.length && (
            <p className="text-sm text-muted-foreground">No artifacts published.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
