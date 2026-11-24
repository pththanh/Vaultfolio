import { ratio } from "../decimal";
import type { CalcCategory, CalcEntry, CategoryKind } from "./types";

/** How an entry counts in income/expense reports; null = not at all. */
export function reportKind(e: CalcEntry): CategoryKind | null {
  if (e.excludeFromReport) return null;
  if (e.type === "income" || e.type === "expense") return e.type;
  if (e.type === "adjustment")
    return e.direction === "in" ? "income" : "expense";
  return null;
}

export const monthOf = (date: string) => date.slice(0, 7);

/** "2026-01" + (-1) → "2025-12" */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const n = y * 12 + (m - 1) + by;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface MonthSummary {
  income: bigint;
  expense: bigint;
  net: bigint;
  /** (income − expense) / income. */
  savingRate: number | null;
}

export function monthSummary(
  entries: readonly CalcEntry[],
  month: string,
): MonthSummary {
  return flowTotal(entries.filter((e) => monthOf(e.occurredOn) === month));
}

export interface CategoryAmount {
  categoryId: string;
  amount: bigint;
  previous: bigint;
  /** Average of the 3 months before. */
  average3: bigint;
}

export interface CategoryGroup extends CategoryAmount {
  /** Subcategories; entries booked directly on the parent appear under its own id. */
  children: CategoryAmount[];
}

/**
 * Amounts per top-level category (children rolled up), largest first. For a year,
 * `previous` is the year before and `average3` is not meaningful (0).
 */
export function byCategory(
  entries: readonly CalcEntry[],
  categories: readonly CalcCategory[],
  period: string,
  kind: CategoryKind,
): CategoryGroup[] {
  const parentOf = new Map(
    categories.map((c) => [c.id, c.parentId ?? c.id] as const),
  );
  const isMonth = period.length === 7;
  const previousPeriod = isMonth
    ? shiftMonth(period, -1)
    : String(Number(period) - 1);
  const window = isMonth
    ? [previousPeriod, shiftMonth(period, -2), shiftMonth(period, -3)]
    : [previousPeriod];
  const sums = new Map<
    string,
    { amount: bigint; previous: bigint; last3: bigint }
  >();
  for (const e of entries) {
    if (!e.categoryId || reportKind(e) !== kind) continue;
    const p = e.occurredOn.slice(0, period.length);
    if (p !== period && !window.includes(p)) continue;
    const s = sums.get(e.categoryId) ?? {
      amount: 0n,
      previous: 0n,
      last3: 0n,
    };
    if (p === period) s.amount += e.amount;
    else if (isMonth) s.last3 += e.amount;
    if (p === previousPeriod) s.previous += e.amount;
    sums.set(e.categoryId, s);
  }

  const groups = new Map<string, CategoryGroup & { last3: bigint }>();
  for (const [categoryId, s] of sums) {
    const parentId = parentOf.get(categoryId) ?? categoryId;
    let g = groups.get(parentId);
    if (!g)
      groups.set(
        parentId,
        (g = {
          categoryId: parentId,
          amount: 0n,
          previous: 0n,
          average3: 0n,
          last3: 0n,
          children: [],
        }),
      );
    g.amount += s.amount;
    g.previous += s.previous;
    g.last3 += s.last3;
    g.children.push({
      categoryId,
      amount: s.amount,
      previous: s.previous,
      average3: s.last3 / 3n,
    });
  }
  const desc = (a: CategoryAmount, b: CategoryAmount) =>
    a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0;
  return [...groups.values()]
    .map(({ last3, ...g }) => ({
      ...g,
      average3: last3 / 3n,
      children: g.children.sort(desc),
    }))
    .sort(desc);
}

/** "2026-03" → that month, "2026" → that year. */
export const periodMatcher = (period: string) => (date: string) =>
  date.startsWith(`${period}-`);

export interface MonthFlow extends MonthSummary {
  month: string;
}

/** `count` consecutive months ending with `endMonth`, oldest first. */
export function flowSeries(
  entries: readonly CalcEntry[],
  endMonth: string,
  count: number,
): MonthFlow[] {
  return Array.from({ length: count }, (_, i) => {
    const month = shiftMonth(endMonth, i - count + 1);
    return { month, ...monthSummary(entries, month) };
  });
}

/** Sum income and expense over any set of entries. */
export function flowTotal(entries: readonly CalcEntry[]): MonthSummary {
  let income = 0n;
  let expense = 0n;
  for (const e of entries) {
    const kind = reportKind(e);
    if (kind === "income") income += e.amount;
    else if (kind === "expense") expense += e.amount;
  }
  return {
    income,
    expense,
    net: income - expense,
    savingRate: ratio(income - expense, income),
  };
}

const largestFirst = (a: { amount: bigint }, b: { amount: bigint }) =>
  a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0;

export function topExpenses<T extends CalcEntry>(
  entries: readonly T[],
  count = 10,
): T[] {
  return entries
    .filter((e) => reportKind(e) === "expense")
    .sort(largestFirst)
    .slice(0, count);
}

export function spendingByWallet(
  entries: readonly CalcEntry[],
): { walletId: string; amount: bigint }[] {
  const sums = new Map<string, bigint>();
  for (const e of entries)
    if (reportKind(e) === "expense")
      sums.set(e.walletId, (sums.get(e.walletId) ?? 0n) + e.amount);
  return [...sums]
    .map(([walletId, amount]) => ({ walletId, amount }))
    .sort(largestFirst);
}
