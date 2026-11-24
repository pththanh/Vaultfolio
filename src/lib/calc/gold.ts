import { divRound } from "./decimal";

/** Gold quantities are stored in chỉ; prices per chỉ. 1 lượng = 10 chỉ = 37,5 g. */
export type GoldUnit = "luong" | "chi" | "gram";

const CHI_PER_LUONG = 10n;
// 1 chỉ = 3,75 g → grams = chỉ × 375 / 100
const GRAM_NUM = 375n;
const GRAM_DEN = 100n;

export function toChi(quantity: bigint, unit: GoldUnit): bigint {
  if (unit === "luong") return quantity * CHI_PER_LUONG;
  if (unit === "gram") return divRound(quantity * GRAM_DEN, GRAM_NUM);
  return quantity;
}

export function fromChi(quantityChi: bigint, unit: GoldUnit): bigint {
  if (unit === "luong") return divRound(quantityChi, CHI_PER_LUONG);
  if (unit === "gram") return divRound(quantityChi * GRAM_NUM, GRAM_DEN);
  return quantityChi;
}

export function perChiToPerLuong(pricePerChi: bigint): bigint {
  return pricePerChi * CHI_PER_LUONG;
}

export function perLuongToPerChi(pricePerLuong: bigint): bigint {
  return divRound(pricePerLuong, CHI_PER_LUONG);
}
