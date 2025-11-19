import { useEffect, useState } from 'react';
import type { PnlResponse } from '../types';
import type { SeriesPoint } from '../components/PnlChart';

export const usePnlHistory = (pnl: PnlResponse | null) => {
  const [history, setHistory] = useState<SeriesPoint[]>([]);

  useEffect(() => {
    if (!pnl) return;
    const total =
      (pnl as any)?.pnl ?? (pnl.netRealized ?? pnl.realized ?? 0) + (pnl.unrealized ?? 0);
    setHistory((prev) => {
      const next = [...prev, { t: Date.now(), value: total }];
      return next.slice(-1200);
    });
  }, [pnl]);

  return history;
};
