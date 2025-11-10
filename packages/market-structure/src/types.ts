import type {
  AssetClass,
  ContractType,
  CurrencyPair,
  Exchange,
  ExchangePair
} from './schema';

export interface VenueCurrency {
  symbol: string;
  assetClass: AssetClass;
  decimals?: number;
  displayName?: string;
  metadata?: Record<string, unknown> | null;
}

export interface VenuePair {
  symbol: string;
  baseSymbol: string;
  quoteSymbol: string;
  assetClass: AssetClass;
  contractType: ContractType;
  metadata?: Record<string, unknown> | null;
}

export interface VenueExchange {
  code: string;
  name: string;
}

export interface VenueExchangeCurrency {
  exchangeCode: string;
  currencySymbol: string;
  exchSymbol: string;
  status?: string;
  metadata?: Record<string, unknown> | null;
}

export interface VenueExchangePair {
  exchangeCode: string;
  pairSymbol: string;
  exchSymbol: string;
  assetClass: AssetClass;
  contractType: ContractType;
  lotSize: number;
  minLotSize: number;
  maxLotSize?: number | null;
  tickSize: number;
  pricePrecision?: number | null;
  quantityPrecision?: number | null;
  quotePrecision?: number | null;
  status?: string;
  metadata?: Record<string, unknown> | null;
}

export interface MarketStructureSnapshotData {
  exchange: VenueExchange;
  currencies: VenueCurrency[];
  pairs: VenuePair[];
  exchangeCurrencies: VenueExchangeCurrency[];
  exchangePairs: VenueExchangePair[];
  raw: unknown;
}

export interface MarketStructureAdapter {
  sync(): Promise<MarketStructureSnapshotData>;
}

export type ExchangePairRecord = {
  exchangePair: ExchangePair;
  exchange: Exchange;
  pair: CurrencyPair;
};
