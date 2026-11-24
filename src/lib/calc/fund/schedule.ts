import { addDays, addMonths, format, parseISO } from "date-fns";

/** Sell fee from `fromMonths` held on, until the next tier starts. */
export interface FeeTier {
  fromMonths: number;
  /** true: from the anniversary itself (>=); false: from the day after (>). */
  fromInclusive: boolean;
  feeBps: number;
}

export interface FundTax {
  bps: number;
  /** Full months held after which the tax is waived. */
  freeMonths: number;
}

/** The holding period waiver only applies to sales from this date. */
export const TAX_WAIVER_FROM = "2026-07-01";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** Same day `months` later, clamped to the end of short months. */
export function anniversary(date: string, months: number): string {
  return iso(addMonths(parseISO(date), months));
}

/** Full calendar months between two dates. */
export function monthsHeld(bought: string, on: string): number {
  let months =
    (Number(on.slice(0, 4)) - Number(bought.slice(0, 4))) * 12 +
    Number(on.slice(5, 7)) -
    Number(bought.slice(5, 7));
  if (anniversary(bought, months) > on) months--;
  return months;
}

/** First day on which a tier applies to a lot bought on `bought`. */
export function tierStart(bought: string, tier: FeeTier): string {
  const day = anniversary(bought, tier.fromMonths);
  return tier.fromInclusive ? day : iso(addDays(parseISO(day), 1));
}

/** Why a set of tiers cannot be saved, or null. */
export function tiersError(tiers: readonly FeeTier[]): string | null {
  if (tiers.length === 0) return "Cần ít nhất một bậc phí";
  if (!tiers.some((t) => t.fromMonths === 0 && t.fromInclusive))
    return "Bậc đầu phải bắt đầu từ 0 tháng (≥)";
  if (new Set(tiers.map((t) => t.fromMonths)).size !== tiers.length)
    return "Hai bậc phí bị trùng số tháng";
  return null;
}

export function tierAt(
  tiers: readonly FeeTier[],
  bought: string,
  on: string,
): FeeTier | null {
  let found: FeeTier | null = null;
  for (const t of tiers)
    if (
      tierStart(bought, t) <= on &&
      (!found || t.fromMonths > found.fromMonths)
    )
      found = t;
  return found;
}

/** Tiers in force on a date; before the first known schedule, the earliest one. */
export function scheduleAt<T extends FeeTier & { effectiveFrom: string }>(
  rows: readonly T[],
  on: string,
): T[] {
  const dates = [...new Set(rows.map((r) => r.effectiveFrom))].sort();
  const current = dates.filter((d) => d <= on).at(-1) ?? dates[0];
  return rows
    .filter((r) => r.effectiveFrom === current)
    .sort((a, b) => a.fromMonths - b.fromMonths);
}

export function holdingTaxBps(
  bought: string,
  on: string,
  tax: FundTax,
): number {
  const waived =
    on >= TAX_WAIVER_FROM && on >= anniversary(bought, tax.freeMonths);
  return waived ? 0 : tax.bps;
}

/** First day with neither sell fee nor tax; null if the schedule never gets there. */
export function freeOfChargesOn(
  bought: string,
  tiers: readonly FeeTier[],
  tax: FundTax,
): string | null {
  const free = tiers
    .filter((t) => t.feeBps === 0)
    .sort((a, b) => a.fromMonths - b.fromMonths)[0];
  if (!free) return null;
  const dates = [tierStart(bought, free)];
  if (tax.bps > 0)
    dates.push(anniversary(bought, tax.freeMonths), TAX_WAIVER_FROM);
  return dates.sort().at(-1)!;
}
