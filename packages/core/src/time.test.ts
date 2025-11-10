import { describe, expect, it } from 'vitest';
import { systemClock, createManualClock } from './time';

describe('time utilities', () => {
  it('systemClock proxies Date.now', () => {
    const before = Date.now();
    const clockValue = systemClock.now();
    const after = Date.now();
    expect(clockValue).toBeGreaterThanOrEqual(before);
    expect(clockValue).toBeLessThanOrEqual(after);
  });

  it('manual clock supports set/advance', () => {
    const clock = createManualClock(100);
    expect(clock.now()).toBe(100);
    clock.advance(50);
    expect(clock.now()).toBe(150);
    clock.set(10);
    expect(clock.now()).toBe(10);
  });
});
