import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@rx-trader/event-store';
import { createAccountState } from './accountState';

const now = Date.now();

const balanceEvent = (venue: string, asset: string, delta: number) => ({
  id: crypto.randomUUID(),
  type: 'account.balance.adjusted' as const,
  ts: now,
  data: {
    id: crypto.randomUUID(),
    t: now,
    accountId: 'ACC',
    venue,
    asset,
    delta,
    reason: 'deposit'
  }
});

describe('createAccountState', () => {
  it('replays existing events and tracks future updates', async () => {
    const store = new InMemoryEventStore();
    await store.append(balanceEvent('paper', 'USD', 1000));
    const handle = await createAccountState(store);

    const initial = handle.getBalance('paper', 'USD');
    expect(initial?.total).toBe(1000);

    await store.append(balanceEvent('paper', 'USD', -200));
    const updated = handle.getBalance('paper', 'USD');
    expect(updated?.total).toBe(800);

    handle.stop();
  });

  it('creates separate base/quote entries from adjustments', async () => {
    const store = new InMemoryEventStore();
    await store.append(balanceEvent('paper', 'BTC', 0.1));
    await store.append(balanceEvent('paper', 'USD', 500));

    const handle = await createAccountState(store);
    expect(handle.getBalance('paper', 'BTC')?.total).toBeCloseTo(0.1);
    expect(handle.getBalance('paper', 'USD')?.total).toBeCloseTo(500);

    await store.append(balanceEvent('paper', 'BTC', -0.05));
    expect(handle.getBalance('paper', 'BTC')?.total).toBeCloseTo(0.05);

    handle.stop();
  });
});
