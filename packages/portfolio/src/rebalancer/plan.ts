import type { BalanceEntry } from '@rx-trader/core/domain';
import type { BalanceSnapshot } from '../balances/types';
import type { RebalanceTarget } from './types';

const EPSILON = 1e-9;

interface RebalanceTransfer {
  from: { venue: string; asset: string };
  to: { venue: string; asset: string };
  amount: number;
  reason: string;
}

export interface RebalancePlan {
  transfers: RebalanceTransfer[];
  deficits: Array<{ venue: string; asset: string; shortfall: number; reason: string }>;
  surpluses: Array<{ venue: string; asset: string; excess: number; reason: string }>;
}

interface Deficit {
  venue: string;
  asset: string;
  amount: number;
  priority: number;
  reason: string;
}

interface Surplus {
  venue: string;
  asset: string;
  amount: number;
  available: number;
  reason: string;
}

export const planRebalance = (
  balances: BalanceSnapshot[],
  targets: RebalanceTarget[]
): RebalancePlan => {
  const transfers: RebalanceTransfer[] = [];
  const deficits: Deficit[] = [];
  const surpluses: Surplus[] = [];
  const balanceMap = new Map<string, BalanceSnapshot>();

  balances.forEach((snapshot) => {
    balanceMap.set(key(snapshot.venue, snapshot.asset), snapshot);
  });

  for (const target of targets) {
    const snapshot = balanceMap.get(key(target.venue, target.asset));
    const total = snapshot ? snapshot.available + snapshot.locked : 0;
    const available = snapshot?.available ?? 0;
    const priority = target.priority ?? 0;

    if (typeof target.min === 'number' && total < target.min - EPSILON) {
      deficits.push({
        venue: target.venue,
        asset: target.asset,
        amount: target.min - total,
        priority: priority + 2,
        reason: 'min'
      });
      continue;
    }

    if (typeof target.max === 'number' && total > target.max + EPSILON) {
      surpluses.push({
        venue: target.venue,
        asset: target.asset,
        amount: total - target.max,
        available,
        reason: 'max'
      });
      continue;
    }

    if (typeof target.target === 'number') {
      if (total < target.target - EPSILON) {
        deficits.push({
          venue: target.venue,
          asset: target.asset,
          amount: target.target - total,
          priority: priority,
          reason: 'target'
        });
      } else if (total > target.target + EPSILON) {
        surpluses.push({
          venue: target.venue,
          asset: target.asset,
          amount: total - target.target,
          available,
          reason: 'target'
        });
      }
    }
  }

  // sort deficits by priority desc, then shortfall desc
  deficits.sort((a, b) => b.priority - a.priority || b.amount - a.amount);
  // sort surpluses by amount desc (more supply first)
  surpluses.sort((a, b) => b.amount - a.amount);

  for (const deficit of deficits) {
    for (const surplus of surpluses) {
      if (surplus.asset !== deficit.asset) continue;
      if (surplus.venue === deficit.venue) continue;
      if (surplus.amount <= EPSILON || surplus.available <= EPSILON) continue;
      const transferAmount = Math.min(deficit.amount, surplus.amount, surplus.available);
      if (transferAmount <= EPSILON) continue;
      transfers.push({
        from: { venue: surplus.venue, asset: surplus.asset },
        to: { venue: deficit.venue, asset: deficit.asset },
        amount: Number(transferAmount.toFixed(8)),
        reason: `${deficit.reason}->${surplus.reason}`
      });
      deficit.amount -= transferAmount;
      surplus.amount -= transferAmount;
      surplus.available -= transferAmount;
      if (deficit.amount <= EPSILON) break;
    }
  }

  const remainingDeficits = deficits
    .filter((d) => d.amount > EPSILON)
    .map((d) => ({
      venue: d.venue,
      asset: d.asset,
      shortfall: Number(d.amount.toFixed(8)),
      reason: d.reason
    }));

  const remainingSurpluses = surpluses
    .filter((s) => s.amount > EPSILON)
    .map((s) => ({
      venue: s.venue,
      asset: s.asset,
      excess: Number(s.amount.toFixed(8)),
      reason: s.reason
    }));

  return {
    transfers,
    deficits: remainingDeficits,
    surpluses: remainingSurpluses
  };
};

export const flattenBalancesState = (
  balances: Record<string, Record<string, BalanceEntry>>
): BalanceSnapshot[] => {
  const snapshots: BalanceSnapshot[] = [];
  for (const [venue, assets] of Object.entries(balances ?? {})) {
    for (const [asset, entry] of Object.entries(assets ?? {})) {
      snapshots.push({
        venue,
        asset,
        available: entry.available,
        locked: entry.locked
      });
    }
  }
  return snapshots;
};

const key = (venue: string, asset: string) => `${venue}:${asset}`;
