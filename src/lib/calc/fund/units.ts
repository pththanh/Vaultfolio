import { divRound, parseDecimal, QTY_SCALE } from "../decimal";

/**
 * Funds are stored in hundreds of certificates (CCQ) with a price per 100 CCQ,
 * so a NAV with two decimals stays an integer and quantity × price is in đồng.
 */
export const CCQ_PER_UNIT = 100n;

/** CCQ (scaled) → stored quantity. */
export function toHundreds(ccq: bigint): bigint {
  return divRound(ccq, CCQ_PER_UNIT);
}

/** Stored quantity → CCQ (scaled). */
export function fromHundreds(quantity: bigint): bigint {
  return quantity * CCQ_PER_UNIT;
}

/** NAV per CCQ, scaled by QTY_SCALE → price per 100 CCQ. */
export function scaledNavToPrice(nav: bigint): bigint {
  const price = nav * CCQ_PER_UNIT;
  if (price % QTY_SCALE !== 0n)
    throw new RangeError("NAV chỉ có tối đa 2 chữ số thập phân");
  return price / QTY_SCALE;
}

/** "12345.67" → 1234567n */
export function navToPrice(nav: string): bigint {
  return scaledNavToPrice(parseDecimal(nav));
}

/** 1234567n → "12345.67" */
export function priceToNav(price: bigint): string {
  const cents = (price % CCQ_PER_UNIT).toString().padStart(2, "0");
  return `${price / CCQ_PER_UNIT}.${cents}`;
}
