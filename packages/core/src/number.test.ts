import { describe, expect, it } from 'vitest';
import { parseFiniteNumber } from './number';

describe('parseFiniteNumber', () => {
  it('parses finite strings and numbers', () => {
    expect(parseFiniteNumber('12.5')).toBe(12.5);
    expect(parseFiniteNumber(7)).toBe(7);
  });

  it('rejects empty, non-finite, and missing values', () => {
    expect(parseFiniteNumber('')).toBe(0);
    expect(parseFiniteNumber('abc')).toBeUndefined();
    expect(parseFiniteNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(parseFiniteNumber(undefined)).toBeUndefined();
    expect(parseFiniteNumber(null)).toBeUndefined();
  });
});
