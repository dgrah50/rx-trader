import { createHash } from 'node:crypto';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export const sha256Hex = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

export const hashCanonical = (value: unknown): string => sha256Hex(canonicalJson(value));

export const deterministicUuid = (key: string): string => {
  const bytes = createHash('sha256').update(key).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
