import { merge, scan, map, filter } from 'rxjs';
import type { Observable } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import { simpleMomentumStrategy, type MomentumStrategyConfig } from './simpleMomentum';
import type { StrategySignal } from '../types';

interface FeedSource {
  id: string;
  feed$: Observable<MarketTick>;
}

interface MultiFeedMomentumConfig extends MomentumStrategyConfig {
  /**
   * Number of feeds that must agree before emitting a trade signal.
   * Defaults to a simple majority (ceil(feeds.length / 2)).
   */
  minConsensus?: number;
  /**
   * Maximum age (ms) for a feed's latest signal to be considered in consensus.
   */
  maxSignalAgeMs?: number;
  /**
   * Maximum tolerated timestamp skew (ms) between the newest feed signal
   * and any other feed in the consensus set.
   */
  maxSkewMs?: number;
  /**
   * Minimum time (ms) between emitting identical consecutive actions to avoid churn.
   */
  minActionIntervalMs?: number;
}

interface FeedSignal {
  signal: StrategySignal;
  ts: number;
}

interface AggregationState {
  signals: Record<string, FeedSignal>;
  lastAction: StrategySignal['action'] | null;
  lastEmitTs: number;
  output: StrategySignal | null;
}

const defaultState: AggregationState = {
  signals: {},
  lastAction: null,
  lastEmitTs: 0,
  output: null
};

export const multiFeedMomentumStrategy = (
  feeds: FeedSource[],
  config: MultiFeedMomentumConfig
): Observable<StrategySignal> => {
  if (!feeds.length) {
    throw new Error('multiFeedMomentumStrategy requires at least one feed');
  }

  const consensusThreshold =
    config.minConsensus ?? Math.max(2, Math.ceil(feeds.length / 2));
  const maxSignalAge = config.maxSignalAgeMs ?? 2_000;
  const maxSkew = config.maxSkewMs ?? 500;
  const minActionInterval = config.minActionIntervalMs ?? 1_000;

  const signalStreams = feeds.map(({ id, feed$ }) =>
    simpleMomentumStrategy(feed$, config).pipe(map((signal) => ({ id, signal })))
  );

  return merge(...signalStreams).pipe(
    scan((state, { id, signal }) => {
      const now = Date.now();
      const nextSignals: Record<string, FeedSignal> = {
        ...state.signals,
        [id]: { signal, ts: signal.t ?? now }
      };

      const latestTs =
        Object.values(nextSignals).reduce((max, entry) => Math.max(max, entry.ts), -Infinity) ??
        -Infinity;

      Object.entries(nextSignals).forEach(([source, payload]) => {
        const tooOld = now - payload.ts > maxSignalAge;
        const tooSkewed =
          Number.isFinite(latestTs) && latestTs !== -Infinity && latestTs - payload.ts > maxSkew;
        if (tooOld || tooSkewed) {
          delete nextSignals[source];
        }
      });

      const recentSignals = Object.values(nextSignals);
      let output: StrategySignal | null = null;

      if (recentSignals.length >= consensusThreshold) {
        const grouped = recentSignals.reduce<Record<string, StrategySignal[]>>((acc, entry) => {
          (acc[entry.signal.action] ??= []).push(entry.signal);
          return acc;
        }, {});

        const winner = Object.entries(grouped)
          .map(([action, signals]) => ({ action: action as StrategySignal['action'], signals }))
          .filter((entry) => entry.signals.length >= consensusThreshold)
          .sort((a, b) => b.signals.length - a.signals.length)[0];

        if (winner) {
          const avgPrice =
            winner.signals.reduce((sum, item) => sum + item.px, 0) / winner.signals.length;
          const candidate: StrategySignal = {
            symbol: config.symbol,
            action: winner.action,
            px: avgPrice,
            t: now
          };
          const sameAction = state.lastAction === candidate.action;
          const withinInterval = now - state.lastEmitTs < minActionInterval;
          if (!(sameAction && withinInterval)) {
            output = candidate;
          }
        }
      }

      return {
        signals: nextSignals,
        lastAction: output ? output.action : state.lastAction,
        lastEmitTs: output ? now : state.lastEmitTs,
        output
      };
    }, defaultState),
    map((state) => state.output),
    filter((signal): signal is StrategySignal => signal !== null)
  );
};
