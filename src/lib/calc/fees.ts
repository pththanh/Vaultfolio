import { divRound } from "./decimal";
import type { AssetClass, TxType } from "./types";

/** Rates in basis points (1 bps = 0,01%). Stored per user, edited in Settings. */
export interface FeeConfig {
  stockFeeBps: number;
  cryptoFeeBps: number;
  goldFeeBps: number;
  sellTaxBps: number;
  dividendTaxBps: number;
  /** Non-term (không kỳ hạn) rate used for early savings withdrawal. */
  demandRateBps: number;
}

export const DEFAULT_FEE_CONFIG: FeeConfig = {
  stockFeeBps: 15,
  cryptoFeeBps: 10,
  goldFeeBps: 0,
  sellTaxBps: 10,
  dividendTaxBps: 500,
  demandRateBps: 10,
};

function bps(amount: bigint, rate: number): bigint {
  return divRound(amount * BigInt(Math.round(rate * 100)), 1_000_000n);
}

/** Suggested fee and tax for a trade; the user can override both in the form. */
export function tradeCharges(
  assetClass: AssetClass,
  type: TxType,
  gross: bigint,
  cfg: FeeConfig,
): { fee: bigint; tax: bigint } {
  const feeRate =
    assetClass === "stock"
      ? cfg.stockFeeBps
      : assetClass === "crypto"
        ? cfg.cryptoFeeBps
        : cfg.goldFeeBps;

  if (type === "buy") return { fee: bps(gross, feeRate), tax: 0n };
  if (type === "sell") {
    return {
      fee: bps(gross, feeRate),
      tax: assetClass === "stock" ? bps(gross, cfg.sellTaxBps) : 0n,
    };
  }
  if (type === "dividend_cash" && assetClass === "stock")
    return { fee: 0n, tax: bps(gross, cfg.dividendTaxBps) };
  return { fee: 0n, tax: 0n };
}
