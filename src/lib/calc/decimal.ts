/**
 * Fixed-point helpers. Quantities are bigint scaled by 1e8 (enough for crypto),
 * money is bigint VND. Floats are only produced for display-only ratios.
 */

export const QTY_DECIMALS = 8;
export const QTY_SCALE = 10n ** BigInt(QTY_DECIMALS);

/** Integer division rounding half away from zero. */
export function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError("Division by zero");
  const negative = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const q = (absA * 2n + absB) / (absB * 2n);
  return negative ? -q : q;
}

/** Parse a canonical decimal string ("-12.345") into a scaled bigint. */
export function parseDecimal(input: string): bigint {
  const s = input.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new SyntaxError(`Số không hợp lệ: "${input}"`);
  const [, sign, int, frac = ""] = m;
  const kept = frac.slice(0, QTY_DECIMALS).padEnd(QTY_DECIMALS, "0");
  let value = BigInt(int) * QTY_SCALE + BigInt(kept);
  const nextDigit = frac.charCodeAt(QTY_DECIMALS) - 48;
  if (nextDigit >= 5) value += 1n;
  return sign ? -value : value;
}

/**
 * Parse a number typed by a Vietnamese user: "." groups thousands and "," is the
 * decimal mark. A single dot followed by exactly three digits (and a non-zero
 * integer part) is read as a thousands separator ("26.950"), otherwise as a
 * decimal point ("0.25", "5.2").
 */
export function parseViNumber(input: string): bigint {
  let s = input.replace(/[\s₫đ]/g, "");
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    const parts = s.split(".");
    if (parts.length > 2) {
      s = parts.join("");
    } else if (parts.length === 2) {
      const [int, frac] = parts;
      const isThousands = frac.length === 3 && !/^-?0$/.test(int);
      s = isThousands ? int + frac : s;
    }
  }
  return parseDecimal(s);
}

/** Integer-only variant for money fields. */
export function parseViMoney(input: string): bigint {
  return divRound(parseViNumber(input), QTY_SCALE);
}

/** quantity (scaled) × price (VND per unit) → VND, rounded. */
export function mulQty(quantity: bigint, price: bigint): bigint {
  return divRound(quantity * price, QTY_SCALE);
}

export function qtyToString(quantity: bigint): string {
  const negative = quantity < 0n;
  const abs = negative ? -quantity : quantity;
  const int = abs / QTY_SCALE;
  const frac = (abs % QTY_SCALE)
    .toString()
    .padStart(QTY_DECIMALS, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

export function qtyToNumber(quantity: bigint): number {
  return Number(qtyToString(quantity));
}

export function toQty(units: bigint): bigint {
  return units * QTY_SCALE;
}

/** a / b as a float, for percentages shown in the UI. */
export function ratio(a: bigint, b: bigint): number | null {
  if (b === 0n) return null;
  return Number((a * 1_000_000_000n) / b) / 1_000_000_000;
}
