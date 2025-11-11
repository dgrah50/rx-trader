import { z } from 'zod';

export const exitConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tpSl: z
    .object({
      enabled: z.boolean().default(false),
      tpSigma: z.number().positive().default(1.5),
      slSigma: z.number().positive().default(1.0),
      sigmaLookbackSec: z.number().positive().default(300),
      asymmetric: z.boolean().default(false)
    })
    .optional(),
  fairValue: z
    .object({
      enabled: z.boolean().default(false),
      epsilonBps: z.number().nonnegative().default(5),
      closeOnSignalFlip: z.boolean().default(true)
    })
    .optional(),
  time: z
    .object({
      enabled: z.boolean().default(false),
      maxHoldMs: z.number().positive(),
      minHoldMs: z.number().nonnegative().optional()
    })
    .optional(),
  trailing: z
    .object({
      enabled: z.boolean().default(false),
      retracePct: z.number().positive().lt(1).default(0.4),
      initArmPnLs: z.number().positive().default(1.0)
    })
    .optional(),
  riskOverrides: z
    .object({
      maxGrossExposureUsd: z.number().positive().optional(),
      maxSymbolExposureUsd: z.number().positive().optional(),
      maxDrawdownPct: z.number().positive().lt(1).optional(),
      marginBufferPct: z.number().positive().lt(1).optional(),
      action: z.enum(['FLATTEN_SYMBOL', 'FLATTEN_ALL']).default('FLATTEN_SYMBOL')
    })
    .optional()
});

export type ExitConfig = z.infer<typeof exitConfigSchema>;
