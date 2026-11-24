export const ASSET_CLASSES = [
  "stock",
  "crypto",
  "gold",
  "savings",
  "index",
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Classes that make up net worth (index is a benchmark only). */
export const PORTFOLIO_CLASSES = [
  "stock",
  "savings",
  "gold",
  "crypto",
] as const;
export type PortfolioClass = (typeof PORTFOLIO_CLASSES)[number];

/** Rows per day in portfolio_snapshots (liability is stored negative). */
export const SNAPSHOT_CLASSES = [
  ...PORTFOLIO_CLASSES,
  "cash",
  "receivable",
  "liability",
] as const;

export const TX_TYPES = [
  "buy",
  "sell",
  "deposit",
  "withdraw",
  "dividend_cash",
  "dividend_stock",
  "bonus_share",
  "fee",
  "interest",
] as const;
export type TxType = (typeof TX_TYPES)[number];

/**
 * A transaction as the calc layer sees it.
 * - quantity: scaled by QTY_SCALE (gold is always in chỉ)
 * - price, fee, tax: integer VND (price per unit; for dividend_cash, per share)
 * - tradeDate: ISO date "YYYY-MM-DD"
 */
export interface CalcTransaction {
  id: string;
  instrumentId: string;
  /** Needed only to track account cash. */
  accountId?: string;
  type: TxType;
  quantity: bigint;
  price: bigint;
  fee: bigint;
  tax: bigint;
  tradeDate: string;
}

export interface PricePoint {
  date: string;
  price: bigint;
}

/** instrumentId → points sorted by date ascending. */
export type PriceSeries = Map<string, PricePoint[]>;
