import { describe, expect, it } from "vitest";
import { debtDue } from "./debts";
import { eventTotals } from "./events";
import { firstOccurrence } from "./recurring";
import type { CalcEntry } from "./types";

describe("firstOccurrence", () => {
  it.each([
    ["monthly", 5, "2026-11-01", "2026-11-05"],
    ["monthly", 5, "2026-11-05", "2026-11-05"],
    ["monthly", 5, "2026-11-06", "2026-12-05"],
    ["monthly", 31, "2026-02-10", "2026-02-28"],
    ["monthly", 31, "2026-04-30", "2026-04-30"],
    ["weekly", 0, "2026-11-24", "2026-11-24"],
    ["yearly", 24, "2026-11-24", "2026-11-24"],
  ] as const)("%s day %i from %s → %s", (freq, day, start, want) =>
    expect(firstOccurrence(freq, day, start)).toBe(want),
  );
});

describe("debtDue", () => {
  it.each([
    [null, null],
    ["2026-11-23", "overdue"],
    ["2026-11-24", "soon"],
    ["2026-12-08", "soon"],
    ["2026-12-09", null],
  ] as const)("%s → %s", (dueOn, want) =>
    expect(debtDue(dueOn, "2026-11-24")).toBe(want),
  );
});

describe("eventTotals", () => {
  const e = (p: Partial<CalcEntry>): CalcEntry => ({
    id: "x",
    type: "expense",
    amount: 0n,
    occurredOn: "2026-11-01",
    walletId: "w",
    toWalletId: null,
    toAccountId: null,
    savingsDepositId: null,
    direction: null,
    categoryId: "c",
    debtId: null,
    excludeFromReport: false,
    ...p,
  });
  it("compares spending with the budget, net of nothing else", () => {
    const entries = [
      e({ amount: 700n }),
      e({ amount: 100n, type: "income" }),
      e({ amount: 50n, excludeFromReport: true }),
    ];
    expect(eventTotals(entries, 1000n)).toEqual({
      expense: 700n,
      income: 100n,
      remaining: 300n,
      ratio: 0.7,
    });
    expect(eventTotals(entries, null)).toMatchObject({
      remaining: null,
      ratio: null,
    });
  });
});
