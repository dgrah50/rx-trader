import { useEffect, useMemo, useState } from 'react';
import {
  type StrategyRuntimeStatus,
  type StrategyMetrics,
  createEmptyStrategyMetrics
} from '../types';

export interface StrategyOption {
  id: string;
  label: string;
}

export interface StrategySelectionResult {
  rows: StrategyRuntimeStatus[];
  selectedStrategy: StrategyRuntimeStatus | null;
  selectedStrategyId: string;
  setSelectedStrategyId: (value: string) => void;
  aggregatedMetrics: StrategyMetrics;
  options: StrategyOption[];
  focusLabel: string;
}

const mergeMetrics = (metrics?: StrategyMetrics): StrategyMetrics => ({
  ...createEmptyStrategyMetrics(),
  ...(metrics ?? {})
});

const accumulateMetrics = (rows: StrategyRuntimeStatus[]): StrategyMetrics => {
  return rows.reduce<StrategyMetrics>((acc, row) => {
    acc.signals += row.metrics?.signals ?? 0;
    acc.intents += row.metrics?.intents ?? 0;
    acc.orders += row.metrics?.orders ?? 0;
    acc.fills += row.metrics?.fills ?? 0;
    acc.rejects += row.metrics?.rejects ?? 0;
    acc.lastSignalTs = maxTimestamp(acc.lastSignalTs, row.metrics?.lastSignalTs ?? null);
    acc.lastIntentTs = maxTimestamp(acc.lastIntentTs, row.metrics?.lastIntentTs ?? null);
    acc.lastOrderTs = maxTimestamp(acc.lastOrderTs, row.metrics?.lastOrderTs ?? null);
    acc.lastFillTs = maxTimestamp(acc.lastFillTs, row.metrics?.lastFillTs ?? null);
    acc.lastRejectTs = maxTimestamp(acc.lastRejectTs, row.metrics?.lastRejectTs ?? null);
    return acc;
  }, createEmptyStrategyMetrics());
};

const maxTimestamp = (a: number | null, b: number | null) => {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
};

export const useStrategySelection = (
  strategies: StrategyRuntimeStatus[] | undefined,
  options?: { defaultToFirst?: boolean }
): StrategySelectionResult => {
  const rows = useMemo(() => {
    return (strategies ?? [])
      .map((strategy) => ({
        ...strategy,
        metrics: mergeMetrics(strategy.metrics)
      }))
      .sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return a.id.localeCompare(b.id);
      });
  }, [strategies]);

  const [selectedStrategyId, setSelectedStrategyId] = useState<string>('all');

  useEffect(() => {
    if (options?.defaultToFirst && selectedStrategyId === 'all' && rows.length > 0) {
      setSelectedStrategyId(rows[0].id);
      return;
    }

    if (selectedStrategyId === 'all') return;
    if (!rows.some((row) => row.id === selectedStrategyId)) {
      setSelectedStrategyId(options?.defaultToFirst && rows.length > 0 ? rows[0].id : 'all');
    }
  }, [rows, selectedStrategyId, options?.defaultToFirst]);

  const selectedStrategy =
    selectedStrategyId === 'all' ? null : rows.find((row) => row.id === selectedStrategyId) ?? null;

  const aggregatedMetrics = useMemo(() => accumulateMetrics(rows), [rows]);

  const options = useMemo<StrategyOption[]>(() => {
    return [
      { id: 'all', label: 'All strategies' },
      ...rows.map((row) => ({ id: row.id, label: `${row.id} · ${row.tradeSymbol}` }))
    ];
  }, [rows]);

  const focusLabel = selectedStrategy ? `${selectedStrategy.id} · ${selectedStrategy.tradeSymbol}` : 'All strategies';

  return {
    rows,
    selectedStrategy,
    selectedStrategyId,
    setSelectedStrategyId,
    aggregatedMetrics,
    options,
    focusLabel
  };
};
