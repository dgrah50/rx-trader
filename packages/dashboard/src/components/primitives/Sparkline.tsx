import { cn } from '@/lib/utils';

export const Sparkline = ({ values, className }: { values: number[]; className?: string }) => {
  if (!values.length) {
    return <div className={cn('h-24 w-full rounded-lg bg-muted/60', className)} />;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values
    .map((value, idx) => {
      const x = (idx / Math.max(values.length - 1, 1)) * 100;
      const y = max === min ? 50 : ((value - min) / (max - min)) * 100;
      return `${x},${100 - y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={cn('h-32 w-full', className)}>
      <polyline
        fill="none"
        stroke="url(#sparklineGradientLive)"
        strokeWidth="3"
        points={points}
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id="sparklineGradientLive" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
    </svg>
  );
};
