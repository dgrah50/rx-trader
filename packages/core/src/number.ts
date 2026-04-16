export const parseFiniteNumber = (value: string | number | null | undefined): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
};
