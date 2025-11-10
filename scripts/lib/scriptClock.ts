import type { Clock } from '@rx-trader/core/time';
import { systemClock } from '@rx-trader/core/time';

export interface ScriptClockMeta {
  label: string;
  source: 'system' | 'fixed';
  startMs: number;
  env?: string;
}

export interface ScriptClock {
  clock: Clock;
  meta: ScriptClockMeta;
}

const parseEnvTimestamp = (value: string | undefined, parser: (raw: string) => number): number | null => {
  if (!value) return null;
  const parsed = parser(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sanitizePrefix = (label: string) =>
  label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'SCRIPT';

export const createScriptClock = (
  label: string,
  options: { envPrefix?: string } = {}
): ScriptClock => {
  const prefix = options.envPrefix ?? sanitizePrefix(label);
  const candidates = [
    `${prefix}_CLOCK_START_MS`,
    `${prefix}_CLOCK_START_ISO`,
    'SCRIPT_CLOCK_START_MS',
    'SCRIPT_CLOCK_START_ISO'
  ];

  let selectedKey: string | undefined;
  let startMs: number | null = null;

  for (const key of candidates) {
    if (key.endsWith('_ISO')) {
      startMs = parseEnvTimestamp(process.env[key], (raw) => Date.parse(raw));
    } else {
      startMs = parseEnvTimestamp(process.env[key], (raw) => Number(raw));
    }
    if (startMs !== null) {
      selectedKey = key;
      break;
    }
  }

  if (startMs !== null) {
    const wallStart = Date.now();
    const clock: Clock = {
      now: () => startMs! + (Date.now() - wallStart)
    };
    return {
      clock,
      meta: {
        label,
        source: 'fixed',
        startMs,
        env: selectedKey
      }
    };
  }

  return {
    clock: systemClock,
    meta: {
      label,
      source: 'system',
      startMs: Date.now()
    }
  };
};
