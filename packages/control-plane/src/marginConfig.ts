import type { StrategyDefinition, AppConfig } from '@rx-trader/config';
import type { StrategyMarginConfig } from '@rx-trader/pipeline';

const normalizeMode = (value?: unknown): 'cash' | 'margin' | 'perp' | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['margin', 'spot-margin', 'margin-spot'].includes(normalized)) return 'margin';
  if (['cash', 'spot', 'cash-spot'].includes(normalized)) return 'cash';
  if (['perp', 'perpetual'].includes(normalized)) return 'perp';
  return null;
};

export const resolveStrategyMarginConfig = (
  definition: StrategyDefinition,
  config: AppConfig,
  contractType?: string
): StrategyMarginConfig => {
  const params = (definition.params ?? {}) as Record<string, unknown>;
  const marginParams = (params.margin ?? {}) as Record<string, unknown>;
  const explicitMode = normalizeMode(marginParams.mode ?? params.marginMode);
  const explicitLeverage =
    typeof marginParams.leverageCap === 'number'
      ? marginParams.leverageCap
      : typeof params.leverageCap === 'number'
        ? params.leverageCap
        : undefined;
  const resolvedProduct = (contractType ?? '').toUpperCase().includes('PERP') ? 'PERP' : 'SPOT';

  let mode: 'cash' | 'margin' | 'perp';
  if (resolvedProduct === 'PERP' || explicitMode === 'perp') {
    mode = 'perp';
  } else if (explicitMode === 'margin') {
    mode = 'margin';
  } else if (explicitMode === 'cash') {
    mode = 'cash';
  } else if (config.margin?.spot?.enabled) {
    mode = 'margin';
  } else {
    mode = 'cash';
  }

  const leverageCapRaw =
    resolvedProduct === 'PERP'
      ? 1
      : explicitLeverage ?? config.margin?.spot?.leverageCap ?? 1;
  const leverageCap = Math.max(1, Number(leverageCapRaw) || 1);

  return {
    mode,
    leverageCap,
    productType: resolvedProduct
  } satisfies StrategyMarginConfig;
};
