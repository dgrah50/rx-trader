import { Subject } from 'rxjs';
import type { MarketTick } from '@rx-trader/core/domain';
import { describe, expect, it } from 'vitest';
import { benchmarkPulseStrategy } from './benchmarkPulse';

const makeTick = (t: number, px: number): MarketTick => ({
  t,
  symbol: 'BTCUSDT',
  bid: px - 0.5,
  ask: px + 0.5,
  last: px
});

describe('benchmarkPulseStrategy', () => {
  it('emits a signal for every qualifying tick change', async () => {
    const subject = new Subject<MarketTick>();
    const signals: string[] = [];

    benchmarkPulseStrategy(subject.asObservable(), {
      symbol: 'BTCUSDT'
    }).subscribe((signal) => signals.push(signal.action));

    [100, 101, 100.2, 101.6, 100.9].forEach((px, idx) => subject.next(makeTick(idx, px)));
    subject.complete();

    expect(signals).toEqual(['BUY', 'SELL', 'BUY', 'SELL']);
  });

  it('applies minDeltaBps and filters flat noise', () => {
    const subject = new Subject<MarketTick>();
    const signals: string[] = [];

    benchmarkPulseStrategy(subject.asObservable(), {
      symbol: 'BTCUSDT',
      minDeltaBps: 50
    }).subscribe((signal) => signals.push(signal.action));

    // ~30 bps delta – should be ignored
    subject.next(makeTick(0, 100));
    subject.next(makeTick(1, 100.03));
    // 70 bps delta – should emit BUY
    subject.next(makeTick(2, 100.73));
    // -100 bps delta – emit SELL
    subject.next(makeTick(3, 99.7));

    expect(signals).toEqual(['BUY', 'SELL']);
  });
});
