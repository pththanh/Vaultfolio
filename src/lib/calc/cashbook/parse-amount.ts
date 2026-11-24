import { QTY_SCALE, parseDecimal } from "../decimal";

const MAX = 10n ** 13n;
const UNIT: Record<string, bigint> = {
  k: 1_000n,
  n: 1_000n,
  ng: 1_000n,
  nghìn: 1_000n,
  ngàn: 1_000n,
  tr: 1_000_000n,
  triệu: 1_000_000n,
  m: 1_000_000n,
  tỷ: 1_000_000_000n,
  tỉ: 1_000_000_000n,
  ty: 1_000_000_000n,
};

const PATTERN =
  /^(\d+(?:[.,]\d+)*)(?:(nghìn|ngàn|triệu|tỷ|tỉ|ty|tr|ng|k|n|m)(\d{1,3})?)?$/;

/** "1.234.567" groups thousands; a single mark not followed by exactly 3 digits is a decimal mark. */
function parseNumber(raw: string): bigint | null {
  if (
    /^[1-9]\d{0,2}(\.\d{3})+$/.test(raw) ||
    /^[1-9]\d{0,2}(,\d{3})+$/.test(raw)
  )
    return parseDecimal(raw.replace(/[.,]/g, ""));
  if (/^\d+([.,]\d{1,8})?$/.test(raw))
    return parseDecimal(raw.replace(",", "."));
  return null;
}

/**
 * Amount typed in quick entry → VND, or null when it is not a valid positive amount.
 * "45k" → 45.000, "1tr2" → 1.200.000, "1,5tr" → 1.500.000, "150" → 150.
 */
export function parseAmount(text: string): bigint | null {
  const s = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s₫đ]/g, "");
  if (s.length > 30) return null;
  const m = PATTERN.exec(s);
  if (!m) return null;
  const [, number, unit, tail] = m;
  if (tail && /[.,]/.test(number)) return null;
  // "1tr25" reads as 1,25 triệu: the tail is always a fraction, even with 3 digits.
  const value = tail ? parseDecimal(`${number}.${tail}`) : parseNumber(number);
  if (value === null) return null;
  const scaled = value * (unit ? UNIT[unit] : 1n);
  if (scaled % QTY_SCALE !== 0n) return null;
  const amount = scaled / QTY_SCALE;
  return amount > 0n && amount <= MAX ? amount : null;
}
