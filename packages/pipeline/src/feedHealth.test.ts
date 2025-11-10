import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  FeedHealthTracker,
  getFeedHealthSnapshots,
  __resetFeedHealthRegistryForTests
} from './feedHealth';

const createMetricsStub = () => ({
  feedStatus: { set: vi.fn() },
  feedReconnects: { inc: vi.fn() },
  feedTickAge: { set: vi.fn() }
});

describe('FeedHealthTracker', () => {
  afterEach(() => {
    __resetFeedHealthRegistryForTests();
  });

  it('records status, reconnects, and tick ages', () => {
    const metrics = createMetricsStub();
    const tracker = new FeedHealthTracker(metrics, 'feed-1');

    tracker.setStatus('connected');
    tracker.recordTick(1_000);
    tracker.recordReconnect();

    tracker.snapshotAge(2_000);

    const snapshots = getFeedHealthSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.id).toBe('feed-1');
    expect(snapshots[0]?.reconnects).toBe(1);
    expect(snapshots[0]?.status).toBe('connecting');
    expect(metrics.feedTickAge.set).toHaveBeenCalled();
  });
});
