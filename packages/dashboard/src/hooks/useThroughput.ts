import { useMemo } from 'react';
import type { EventMessage } from '../types';

export const useThroughput = (events: EventMessage[]) =>
  useMemo(() => {
    const now = Date.now();
    const windowMs = 60_000;
    const counts = { ticks: 0, signals: 0, orders: 0 };
    events.forEach((evt) => {
      const ts = evt.ts ?? now;
      if (now - ts > windowMs) return;
      if (evt.type === 'market.tick') counts.ticks += 1;
      if (evt.type === 'strategy.signal') counts.signals += 1;
      if (evt.type.startsWith('order.')) counts.orders += 1;
    });
    const factor = windowMs / 1000;
    return {
      ticksPerSec: counts.ticks / factor,
      signalsPerSec: counts.signals / factor,
      ordersPerSec: counts.orders / factor
    };
  }, [events]);
