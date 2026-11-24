import { divRound, ratio } from "../decimal";
import { daysInMonth, monthOf, reportKind, shiftMonth } from "./report";
import type { CalcCategory, CalcEntry } from "./types";

export interface CalcBudget {
  /** null = total spending. */
  categoryId: string | null;
  amount: bigint;
  alertPct: number;
}

export interface BudgetStatus {
  spent: bigint;
  remaining: bigint;
  ratio: number;
  /** Month-end projection at the current pace. */
  projected: bigint;
  state: "ok" | "warn" | "over";
}

export function budgetStatus(
  budget: CalcBudget,
  entries: readonly CalcEntry[],
  categories: readonly CalcCategory[],
  month: string,
  today: string,
): BudgetStatus {
  const covered = new Set(
    categories
      .filter(
        (c) => c.id === budget.categoryId || c.parentId === budget.categoryId,
      )
      .map((c) => c.id),
  );
  let spent = 0n;
  for (const e of entries) {
    if (monthOf(e.occurredOn) !== month || reportKind(e) !== "expense")
      continue;
    if (
      budget.categoryId === null ||
      (e.categoryId && covered.has(e.categoryId))
    )
      spent += e.amount;
  }
  const days = daysInMonth(month);
  const current = monthOf(today);
  const elapsed =
    month < current ? days : month > current ? 0 : Number(today.slice(8));
  return {
    spent,
    remaining: budget.amount - spent,
    ratio: ratio(spent, budget.amount) ?? 0,
    projected: elapsed
      ? divRound(spent * BigInt(days), BigInt(elapsed))
      : spent,
    state:
      spent >= budget.amount
        ? "over"
        : spent * 100n >= budget.amount * BigInt(budget.alertPct)
          ? "warn"
          : "ok",
  };
}

/** Budget of one category over a span of months (inclusive, yyyy-mm). */
export interface BudgetSegment {
  effectiveFrom: string;
  effectiveTo: string | null;
  amount: bigint;
  alertPct: number;
}

export function budgetsForMonth<
  T extends Omit<BudgetSegment, "amount" | "alertPct">,
>(rows: readonly T[], month: string): T[] {
  return rows.filter(
    (r) =>
      r.effectiveFrom <= month &&
      (r.effectiveTo === null || r.effectiveTo >= month),
  );
}

/**
 * Set (or remove, with null) a category's budget for one month or from a month
 * on, keeping what applied in the other months. Segments never overlap.
 */
export function replaceBudget(
  segments: readonly BudgetSegment[],
  month: string,
  scope: "month" | "onward",
  value: { amount: bigint; alertPct: number } | null,
): BudgetSegment[] {
  const out: BudgetSegment[] = [];
  for (const s of segments) {
    if (s.effectiveFrom < month) {
      const last = shiftMonth(month, -1);
      out.push({
        ...s,
        effectiveTo:
          s.effectiveTo !== null && s.effectiveTo < last ? s.effectiveTo : last,
      });
    }
    if (
      scope === "month" &&
      (s.effectiveTo === null || s.effectiveTo > month)
    ) {
      const next = shiftMonth(month, 1);
      out.push({
        ...s,
        effectiveFrom: s.effectiveFrom > next ? s.effectiveFrom : next,
      });
    }
  }
  if (value)
    out.push({
      effectiveFrom: month,
      effectiveTo: scope === "month" ? month : null,
      ...value,
    });
  return out.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
}

const RANK = { ok: 0, warn: 1, over: 2 } as const;

/** Budgets that a change in entries pushed past the alert threshold or the limit. */
export function budgetAlerts<T extends CalcBudget>(
  budgets: readonly T[],
  before: readonly CalcEntry[],
  after: readonly CalcEntry[],
  categories: readonly CalcCategory[],
  month: string,
): { budget: T; state: "warn" | "over"; status: BudgetStatus }[] {
  // The projection is not used here, so any day of the month will do.
  const day = `${month}-01`;
  return budgets.flatMap((budget) => {
    const was = budgetStatus(budget, before, categories, month, day);
    const now = budgetStatus(budget, after, categories, month, day);
    return now.state !== "ok" && RANK[now.state] > RANK[was.state]
      ? [{ budget, state: now.state, status: now }]
      : [];
  });
}
