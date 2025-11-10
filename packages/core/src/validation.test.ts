import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { safeParse } from './validation';

describe('safeParse', () => {
  const booleanEnv = z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
    }
    return value;
  }, z.boolean());

  const schema = z.object({
    flag: booleanEnv.default(false),
    qty: z.coerce.number()
  });

  it('coerces when forced even if production mode', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalMode = process.env.VALIDATION_MODE;
    process.env.NODE_ENV = 'production';
    delete process.env.VALIDATION_MODE;
    const result = safeParse(schema, { flag: 'false', qty: '42' }, { force: true });
    expect(result.flag).toBe(false);
    expect(result.qty).toBe(42);
    process.env.NODE_ENV = originalEnv;
    if (originalMode === undefined) {
      delete process.env.VALIDATION_MODE;
    } else {
      process.env.VALIDATION_MODE = originalMode;
    }
  });

  it('throws when validation enabled and schema fails', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalMode = process.env.VALIDATION_MODE;
    process.env.NODE_ENV = 'development';
    process.env.VALIDATION_MODE = 'always';
    expect(() => safeParse(schema.pick({ qty: true }), { qty: 'abc' }, { force: true })).toThrow();
    process.env.NODE_ENV = originalEnv;
    if (originalMode === undefined) {
      delete process.env.VALIDATION_MODE;
    } else {
      process.env.VALIDATION_MODE = originalMode;
    }
  });
});
