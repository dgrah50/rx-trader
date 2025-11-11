export const formatNumber = (value: number | null | undefined, precision = 2) =>
  Number.isFinite(value ?? NaN) ? (value as number).toFixed(precision) : '—';

export const formatPercent = (value: number | null | undefined, precision = 2) =>
  Number.isFinite(value ?? NaN) ? `${((value as number) * 100).toFixed(precision)}%` : '—';

export const formatAgo = (ts: number | null | undefined) => {
  if (!ts) return '—';
  const delta = Date.now() - ts;
  if (delta < 1_000) return 'just now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
};
