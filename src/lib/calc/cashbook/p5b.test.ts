import { describe, expect, it } from "vitest";
import {
  budgetAlerts,
  budgetsForMonth,
  replaceBudget,
  type BudgetSegment,
} from "./budget";
import {
  flowSeries,
  periodMatcher,
  spendingByWallet,
  topExpenses,
} from "./report";
import type { CalcEntry } from "./types";

const seg = (
  effectiveFrom: string,
  effectiveTo: string | null,
  amount = 100n,
): BudgetSegment => ({ effectiveFrom, effectiveTo, amount, alertPct: 80 });
const value = { amount: 500n, alertPct: 90 };

describe("replaceBudget", () => {
  it("starts a budget from a month on, ending what applied before and dropping what came later", () => {
    expect(
      replaceBudget(
        [seg("2026-01", "2026-06"), seg("2026-08", null)],
        "2026-03",
        "onward",
        value,
      ),
    ).toEqual([
      seg("2026-01", "2026-02"),
      { effectiveFrom: "2026-03", effectiveTo: null, ...value },
    ]);
  });
  it("changes one month by splitting the segment around it", () => {
    expect(
      replaceBudget([seg("2026-01", null)], "2026-03", "month", value),
    ).toEqual([
      seg("2026-01", "2026-02"),
      { effectiveFrom: "2026-03", effectiveTo: "2026-03", ...value },
      seg("2026-04", null),
    ]);
  });
  it("handles edges without empty segments", () => {
    expect(
      replaceBudget([seg("2026-03", "2026-03")], "2026-03", "month", value),
    ).toEqual([{ effectiveFrom: "2026-03", effectiveTo: "2026-03", ...value }]);
    expect(
      replaceBudget([seg("2025-12", null)], "2026-01", "month", value)[0],
    ).toEqual(seg("2025-12", "2025-12"));
    expect(replaceBudget([], "2026-01", "onward", value)).toHaveLength(1);
  });
  it("removes with null", () => {
    expect(
      replaceBudget([seg("2026-01", null)], "2026-03", "onward", null),
    ).toEqual([seg("2026-01", "2026-02")]);
    expect(
      replaceBudget([seg("2026-01", "2026-04")], "2026-03", "month", null),
    ).toEqual([seg("2026-01", "2026-02"), seg("2026-04", "2026-04")]);
  });
});

describe("budgetsForMonth", () => {
  it("picks the segments covering the month", () => {
    const rows = [seg("2026-01", "2026-02"), seg("2026-03", null)];
    expect(budgetsForMonth(rows, "2026-02")).toEqual([rows[0]]);
    expect(budgetsForMonth(rows, "2027-02")).toEqual([rows[1]]);
    expect(budgetsForMonth(rows, "2025-12")).toEqual([]);
  });
});

let seq = 0;
const e = (
  amount: bigint,
  occurredOn: string,
  p: Partial<CalcEntry> = {},
): CalcEntry => ({
  id: String(seq++),
  type: "expense",
  amount,
  occurredOn,
  walletId: "w1",
  toWalletId: null,
  toAccountId: null,
  savingsDepositId: null,
  direction: null,
  categoryId: "food",
  debtId: null,
  excludeFromReport: false,
  ...p,
});

describe("budgetAlerts", () => {
  const b = { id: "b", categoryId: null, amount: 100n, alertPct: 80 };
  const at = (before: bigint, after: bigint) =>
    budgetAlerts(
      [b],
      [e(before, "2026-03-01")],
      [e(after, "2026-03-01")],
      [],
      "2026-03",
    ).map((a) => a.state);
  it("fires only when a threshold is crossed upwards", () => {
    expect(at(10n, 79n)).toEqual([]);
    expect(at(10n, 80n)).toEqual(["warn"]);
    expect(at(80n, 99n)).toEqual([]);
    expect(at(80n, 100n)).toEqual(["over"]);
    expect(at(10n, 150n)).toEqual(["over"]);
    expect(at(150n, 160n)).toEqual([]);
    expect(at(150n, 85n)).toEqual([]);
  });
});

describe("period reports", () => {
  const entries = [
    e(100n, "2026-03-05"),
    e(30n, "2026-03-06", { walletId: "w2" }),
    e(500n, "2026-03-07", { type: "income" }),
    e(70n, "2025-12-31"),
    e(999n, "2026-03-08", { excludeFromReport: true }),
    e(888n, "2026-03-09", {
      type: "transfer",
      toWalletId: "w2",
      categoryId: null,
    }),
  ];
  it("matches a month or a year", () => {
    expect(periodMatcher("2026-03")("2026-03-31")).toBe(true);
    expect(periodMatcher("2026")("2026-12-31")).toBe(true);
    expect(periodMatcher("2026")("2025-12-31")).toBe(false);
  });
  it("builds a gap-free monthly series", () => {
    const s = flowSeries(entries, "2026-03", 4);
    expect(s.map((x) => [x.month, x.income, x.expense, x.net])).toEqual([
      ["2025-12", 0n, 70n, -70n],
      ["2026-01", 0n, 0n, 0n],
      ["2026-02", 0n, 0n, 0n],
      ["2026-03", 500n, 130n, 370n],
    ]);
  });
  it("ranks expenses and wallets", () => {
    const inMarch = entries.filter((x) =>
      periodMatcher("2026-03")(x.occurredOn),
    );
    expect(topExpenses(inMarch, 1).map((x) => x.amount)).toEqual([100n]);
    expect(spendingByWallet(inMarch)).toEqual([
      { walletId: "w1", amount: 100n },
      { walletId: "w2", amount: 30n },
    ]);
  });
});
