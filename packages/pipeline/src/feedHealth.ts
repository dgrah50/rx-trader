
type FeedStatus = 'connecting' | 'connected' | 'disconnected';

export interface FeedHealthSnapshot {
  id: string;
  status: FeedStatus;
  reconnects: number;
  lastTickTs: number | null;
  ageSeconds: number | null;
}

type FeedMetricHandles = {
  feedStatus: { set(labels: Record<string, string>, value: number): void };
  feedReconnects: { inc(labels: Record<string, string>): void };
  feedTickAge: { set(labels: Record<string, string>, value: number): void };
};

const registry = new Map<string, FeedHealthTracker>();
let sampler: ReturnType<typeof setInterval> | null = null;

const startSampler = () => {
  if (sampler) return;
  sampler = setInterval(() => {
    const now = Date.now();
    registry.forEach((tracker) => tracker.snapshotAge(now));
  }, 1_000);
};

export class FeedHealthTracker {
  private status: FeedStatus = 'connecting';
  private reconnects = 0;
  private lastTickTs: number | null = null;

  constructor(private readonly metrics: FeedMetricHandles, public readonly id: string) {
    registry.set(id, this);
    startSampler();
    this.metrics.feedStatus.set({ feed: id }, 0);
  }

  setStatus(status: FeedStatus) {
    this.status = status;
    this.metrics.feedStatus.set({ feed: this.id }, status === 'connected' ? 1 : 0);
  }

  recordReconnect() {
    this.reconnects += 1;
    this.metrics.feedReconnects.inc({ feed: this.id });
    this.setStatus('connecting');
  }

  recordTick(timestampMs: number) {
    this.lastTickTs = timestampMs;
    this.metrics.feedTickAge.set({ feed: this.id }, 0);
  }

  snapshotAge(nowMs: number) {
    if (this.lastTickTs === null) return;
    const age = Math.max(0, (nowMs - this.lastTickTs) / 1000);
    this.metrics.feedTickAge.set({ feed: this.id }, age);
  }

  toSnapshot(nowMs: number = Date.now()): FeedHealthSnapshot {
    const ageSeconds = this.lastTickTs === null ? null : Math.max(0, (nowMs - this.lastTickTs) / 1000);
    return {
      id: this.id,
      status: this.status,
      reconnects: this.reconnects,
      lastTickTs: this.lastTickTs,
      ageSeconds
    };
  }

  dispose() {
    registry.delete(this.id);
    if (registry.size === 0 && sampler) {
      clearInterval(sampler);
      sampler = null;
    }
  }
}

export const getFeedHealthSnapshots = (): FeedHealthSnapshot[] => {
  const now = Date.now();
  return Array.from(registry.values()).map((tracker) => tracker.toSnapshot(now));
};

export const __resetFeedHealthRegistryForTests = () => {
  registry.clear();
  if (sampler) {
    clearInterval(sampler);
    sampler = null;
  }
};
