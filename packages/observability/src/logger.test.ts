import { describe, expect, it, vi, afterEach } from 'vitest';
import { createLogger } from './logger';
import * as logStream from './logStream';
import { createManualClock } from '@rx-trader/core/time';

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes log entries stamped with injected clock time', () => {
    const clock = createManualClock(42);
    const publishSpy = vi.spyOn(logStream, 'publishLogEntry').mockImplementation(() => {});
    const logger = createLogger('test', {}, clock);

    logger.info('hello');

    expect(publishSpy).toHaveBeenCalled();
    const entry = publishSpy.mock.calls[0][0];
    expect(entry.t).toBe(42);
  });
});
