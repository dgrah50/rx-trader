import pino from 'pino';
import type { LoggerOptions, Logger as PinoLogger } from 'pino';
import { publishLogEntry } from './logStream';
import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';

const formatLogEntry = (clock: Clock, name: string, level: string, args: unknown[]) => {
  const [first, ...rest] = args;
  let msg = '';
  let data: Record<string, unknown> | undefined;

  if (typeof first === 'string') {
    msg = first;
    if (rest[0] && typeof rest[0] === 'object') {
      data = rest[0] as Record<string, unknown>;
    }
  } else if (typeof first === 'object' && first !== null) {
    data = first as Record<string, unknown>;
    if (typeof rest[0] === 'string') {
      msg = rest[0];
    } else if (typeof (data.msg as unknown) === 'string') {
      msg = String(data.msg);
    } else {
      msg = '';
    }
  } else if (rest[0] && typeof rest[0] === 'string') {
    msg = rest[0];
  }

  return {
    id: crypto.randomUUID(),
    t: clock.now(),
    name,
    level,
    msg,
    data
  };
};

export const createLogger = (
  name: string,
  options: LoggerOptions = {},
  clock: Clock = systemClock
) =>
  pino({
    name,
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    hooks: {
      logMethod(this: PinoLogger, args, method, level) {
        try {
          const levelLabel =
            (this.levels && this.levels.labels && this.levels.labels[level]) ?? String(level);
          const entry = formatLogEntry(clock, name, levelLabel, args);
          publishLogEntry(entry);
        } catch {
          // swallow log-stream errors to avoid affecting primary logging
        }
        method.apply(this, args);
      }
    },
    ...options
  });
