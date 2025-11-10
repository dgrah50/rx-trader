import type { AccountTransfer } from '@rx-trader/core/domain';
import type { LoggerInstance } from '@rx-trader/pipeline';

interface TransferExecutionResult {
  amount: number;
  metadata?: Record<string, unknown>;
}

export interface TransferProvider {
  id: string;
  canHandle: (transfer: AccountTransfer) => boolean;
  execute: (transfer: AccountTransfer) => Promise<TransferExecutionResult>;
}

export class MockTransferProvider implements TransferProvider {
  public readonly id = 'mock';
  constructor(private readonly options: { delayMs?: number } = {}) {}

  canHandle(): boolean {
    return true;
  }

  async execute(transfer: AccountTransfer): Promise<TransferExecutionResult> {
    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }
    return {
      amount: transfer.amount,
      metadata: { mode: this.id }
    };
  }
}

interface TransferProviderFactoryInput {
  mode: 'manual' | 'mock' | 'binance' | 'hyperliquid';
  live: boolean;
  logger: LoggerInstance;
}

export const createTransferProviders = ({
  mode,
  live,
  logger
}: TransferProviderFactoryInput): TransferProvider[] => {
  switch (mode) {
    case 'mock':
      if (live) {
        logger.warn(
          { component: 'rebalancer', mode },
          'Mock transfer provider disabled in live mode; falling back to manual approvals'
        );
        return [];
      }
      return [new MockTransferProvider()];
    case 'manual':
      return [];
    case 'binance':
    case 'hyperliquid':
      logger.warn(
        { component: 'rebalancer', mode },
        'Transfer provider not implemented yet; manual approval required'
      );
      return [];
    default:
      logger.warn(
        { component: 'rebalancer', mode },
        'Unknown transfer provider mode; manual approval required'
      );
      return [];
  }
};
