import { describe, expect, it } from "vitest";
import { parseDecimal as q } from "../decimal";
import type { CalcTransaction } from "../types";
import { periodChange, type PortfolioInput } from "../valuation";
import { accountCash, creditCard, walletBalance } from "./balance";
import { budgetStatus } from "./budget";
import { DebtError, debtRemaining, settleDebt } from "./debts";
import { cashPosition, fullNetWorthAt, wealthChange } from "./net-worth";
import { parseAmount } from "./parse-amount";
import { generateDue, nextOccurrence } from "./recurring";
import { byCategory, daysInMonth, monthSummary, shiftMonth } from "./report";
import type { CalcEntry, CalcWallet, CashInput } from "./types";

let seq = 0;
function e(
  p: Partial<CalcEntry> & Pick<CalcEntry, "type" | "amount" | "occurredOn">,
): CalcEntry {
  return {
    id: String(seq++),
    walletId: "cash",
    toWalletId: null,
    toAccountId: null,
    savingsDepositId: null,
    direction: null,
    categoryId: null,
    debtId: null,
    excludeFromReport: p.type === "adjustment",
    ...p,
  };
}
const wallet = (id: string, openingBalance = 0n): CalcWallet => ({
  id,
  openingBalance,
  openingDate: "2026-01-01",
  includeInNetWorth: true,
});

describe("parseAmount", () => {
  it.each([
    ["45k", 45_000n],
    ["45K", 45_000n],
    ["45.000", 45_000n],
    ["45,000", 45_000n],
    ["1.234.567", 1_234_567n],
    ["1tr2", 1_200_000n],
    ["1tr25", 1_250_000n],
    ["1tr250", 1_250_000n],
    ["1k5", 1_500n],
    ["1,5tr", 1_500_000n],
    ["1.5tr", 1_500_000n],
    ["1.500k", 1_500_000n],
    ["0,125tr", 125_000n],
    ["2tr", 2_000_000n],
    ["2 triệu", 2_000_000n],
    ["1 tỷ", 1_000_000_000n],
    ["150", 150n],
    ["150 ₫", 150n],
    ["10000000000000", 10n ** 13n],
  ])("%s → %s", (text, value) => expect(parseAmount(text)).toBe(value));

  it.each([
    "",
    "0",
    "-5",
    "abc",
    "45x",
    "1,5",
    "1.5",
    "1tr2k",
    "1,2tr3",
    "k",
    "1..000",
    "1.00.000",
    "10000000000001",
    "10000001tr",
    "9".repeat(60),
    "0,0001k",
  ])("rejects %s", (text) => expect(parseAmount(text)).toBeNull());
});

describe("walletBalance", () => {
  const entries = [
    e({ type: "income", amount: 1000n, occurredOn: "2026-01-02" }),
    e({ type: "expense", amount: 300n, occurredOn: "2026-01-03" }),
    e({
      type: "transfer",
      amount: 200n,
      occurredOn: "2026-01-04",
      toWalletId: "bank",
    }),
    e({
      type: "adjustment",
      amount: 50n,
      occurredOn: "2026-01-05",
      direction: "in",
    }),
    e({
      type: "adjustment",
      amount: 10n,
      occurredOn: "2026-01-05",
      direction: "out",
    }),
    e({
      type: "transfer",
      amount: 40n,
      occurredOn: "2026-01-06",
      toAccountId: "DNSE",
      direction: "out",
    }),
    e({
      type: "transfer",
      amount: 15n,
      occurredOn: "2026-01-06",
      savingsDepositId: "s",
      direction: "in",
    }),
    e({ type: "lend", amount: 5n, occurredOn: "2026-01-07", debtId: "d" }),
    e({ type: "collect", amount: 2n, occurredOn: "2026-01-07", debtId: "d" }),
    e({ type: "borrow", amount: 7n, occurredOn: "2026-01-07", debtId: "b" }),
    e({ type: "repay", amount: 3n, occurredOn: "2026-01-07", debtId: "b" }),
  ];
  it("applies every type", () => {
    expect(walletBalance(wallet("cash", 100n), entries, "2026-02-01")).toBe(
      616n,
    );
    expect(walletBalance(wallet("bank"), entries, "2026-02-01")).toBe(200n);
  });
  it("is dated, and zero before the opening date", () => {
    expect(walletBalance(wallet("cash", 100n), entries, "2026-01-02")).toBe(
      1100n,
    );
    expect(walletBalance(wallet("cash", 100n), entries, "2025-12-31")).toBe(0n);
  });
  it("shows what a credit card owes and has left", () => {
    expect(creditCard(-300n, 1000n)).toEqual({ owed: 300n, available: 700n });
    expect(creditCard(50n, 1000n)).toEqual({ owed: 0n, available: 1050n });
    expect(creditCard(-1n, null)).toEqual({ owed: 1n, available: null });
  });
});

describe("debts", () => {
  const debt = {
    id: "d",
    direction: "lent" as const,
    principal: 100n,
    startOn: "2026-01-01",
  };
  it("goes down with collections, whether or not a lend entry exists", () => {
    const entries = [
      e({ type: "lend", amount: 100n, occurredOn: "2026-01-01", debtId: "d" }),
      e({
        type: "collect",
        amount: 30n,
        occurredOn: "2026-02-01",
        debtId: "d",
      }),
    ];
    expect(debtRemaining(debt, entries, "2025-12-31")).toBe(0n);
    expect(debtRemaining(debt, entries, "2026-01-31")).toBe(100n);
    expect(debtRemaining(debt, entries.slice(1), "2026-02-01")).toBe(70n);
  });
  it("settles at zero and rejects overpaying", () => {
    expect(settleDebt(70n, 70n)).toEqual({ remaining: 0n, status: "settled" });
    expect(settleDebt(70n, 20n)).toEqual({ remaining: 50n, status: "open" });
    expect(() => settleDebt(70n, 71n)).toThrow(DebtError);
    expect(() => settleDebt(70n, 0n)).toThrow(DebtError);
  });
});

describe("reports", () => {
  const cats = [
    { id: "food", kind: "expense" as const, parentId: null },
    { id: "coffee", kind: "expense" as const, parentId: "food" },
    { id: "salary", kind: "income" as const, parentId: null },
  ];
  const entries = [
    e({
      type: "income",
      amount: 1000n,
      occurredOn: "2026-03-01",
      categoryId: "salary",
    }),
    e({
      type: "expense",
      amount: 100n,
      occurredOn: "2026-03-31",
      categoryId: "coffee",
    }),
    e({
      type: "expense",
      amount: 150n,
      occurredOn: "2026-03-02",
      categoryId: "food",
    }),
    e({
      type: "expense",
      amount: 90n,
      occurredOn: "2026-02-28",
      categoryId: "coffee",
    }),
    e({
      type: "expense",
      amount: 60n,
      occurredOn: "2025-12-31",
      categoryId: "food",
    }),
    e({
      type: "expense",
      amount: 999n,
      occurredOn: "2026-03-05",
      categoryId: "food",
      excludeFromReport: true,
    }),
    e({
      type: "transfer",
      amount: 500n,
      occurredOn: "2026-03-05",
      toWalletId: "bank",
    }),
    e({
      type: "adjustment",
      amount: 77n,
      occurredOn: "2026-03-05",
      direction: "out",
    }),
    e({ type: "borrow", amount: 400n, occurredOn: "2026-03-05", debtId: "b" }),
  ];
  it("leaves transfers, debts and excluded entries out of income and expense", () => {
    expect(monthSummary(entries, "2026-03")).toEqual({
      income: 1000n,
      expense: 250n,
      net: 750n,
      savingRate: 0.75,
    });
    expect(monthSummary(entries, "2026-04").savingRate).toBeNull();
  });
  it("counts an adjustment when its exclusion flag is off", () => {
    const adj = e({
      type: "adjustment",
      amount: 77n,
      occurredOn: "2026-03-05",
      direction: "out",
      excludeFromReport: false,
    });
    expect(monthSummary([adj], "2026-03").expense).toBe(77n);
  });
  it("rolls children up and compares with earlier months", () => {
    const [food, ...rest] = byCategory(entries, cats, "2026-03", "expense");
    expect(rest).toEqual([]);
    expect(food).toMatchObject({
      categoryId: "food",
      amount: 250n,
      previous: 90n,
      average3: 50n,
    });
    expect(food.children.map((c) => [c.categoryId, c.amount])).toEqual([
      ["food", 150n],
      ["coffee", 100n],
    ]);
  });
  it("handles month arithmetic", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(daysInMonth("2028-02")).toBe(29);
  });

  it("tracks budgets including subcategories", () => {
    const b = { categoryId: "food", amount: 300n, alertPct: 80 };
    expect(budgetStatus(b, entries, cats, "2026-03", "2026-03-10")).toEqual({
      spent: 250n,
      remaining: 50n,
      ratio: 0.833333333,
      projected: 775n,
      state: "warn",
    });
    const at = (amount: bigint, today: string) =>
      budgetStatus(
        { ...b, categoryId: null, amount },
        entries,
        cats,
        "2026-03",
        today,
      );
    expect(at(250n, "2026-04-01")).toMatchObject({
      state: "over",
      projected: 250n,
    });
    expect(at(313n, "2026-03-31").state).toBe("ok");
    expect(at(300n, "2026-02-01").projected).toBe(250n);
  });
});

describe("recurring", () => {
  const rule = {
    id: "r",
    freq: "monthly" as const,
    day: 31,
    nextRunOn: "2026-01-31",
    active: true,
  };
  it("clamps day 31 to short months without drifting", () => {
    expect(generateDue([rule], "2026-04-30")).toEqual({
      due: ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"].map(
        (occurredOn) => ({ ruleId: "r", occurredOn }),
      ),
      next: [{ ruleId: "r", nextRunOn: "2026-05-31" }],
    });
  });
  it("does nothing when not due or inactive", () => {
    expect(generateDue([rule], "2026-01-30").due).toEqual([]);
    expect(generateDue([{ ...rule, active: false }], "2026-12-31").due).toEqual(
      [],
    );
  });
  it("supports weekly and yearly (29/02)", () => {
    expect(nextOccurrence({ freq: "weekly", day: 1 }, "2026-12-28")).toBe(
      "2027-01-04",
    );
    expect(nextOccurrence({ freq: "yearly", day: 29 }, "2028-02-29")).toBe(
      "2029-02-28",
    );
  });
});

describe("net worth with cash", () => {
  const tx = (
    p: Partial<CalcTransaction> & Pick<CalcTransaction, "type" | "tradeDate">,
  ): CalcTransaction => ({
    id: String(seq++),
    instrumentId: "HPG",
    accountId: "DNSE",
    quantity: 0n,
    price: 0n,
    fee: 0n,
    tax: 0n,
    ...p,
  });
  const base: PortfolioInput = {
    transactions: [],
    assetClassOf: () => "stock",
    prices: new Map([
      [
        "HPG",
        [
          { date: "2026-01-01", price: 10_000n },
          { date: "2026-02-10", price: 11_000n },
        ],
      ],
    ]),
    savings: [],
  };
  const none: CashInput = { wallets: [], entries: [], debts: [], accounts: [] };

  it("keeps money in view from wallet to broker to shares and back", () => {
    const input: PortfolioInput = {
      ...base,
      transactions: [
        tx({
          type: "buy",
          quantity: q("1000"),
          price: 10_000n,
          tradeDate: "2026-01-12",
        }),
        tx({
          type: "sell",
          quantity: q("1000"),
          price: 10_000n,
          tradeDate: "2026-01-14",
        }),
      ],
    };
    const cash: CashInput = {
      ...none,
      wallets: [wallet("bank", 30_000_000n)],
      accounts: [{ id: "DNSE", cashOpening: 0n, cashFrom: "2026-01-05" }],
      entries: [
        e({
          type: "transfer",
          amount: 10_000_000n,
          occurredOn: "2026-01-11",
          walletId: "bank",
          toAccountId: "DNSE",
          direction: "out",
        }),
        e({
          type: "transfer",
          amount: 4_000_000n,
          occurredOn: "2026-01-15",
          walletId: "bank",
          toAccountId: "DNSE",
          direction: "in",
        }),
      ],
    };
    for (const day of [
      "2026-01-10",
      "2026-01-11",
      "2026-01-12",
      "2026-01-13",
      "2026-01-14",
      "2026-01-15",
    ])
      expect(fullNetWorthAt(input, cash, day).total).toBe(30_000_000n);
    expect(
      accountCash(
        cash.accounts[0],
        input.transactions,
        cash.entries,
        "2026-01-15",
      ),
    ).toBe(6_000_000n);
    expect(
      accountCash(
        cash.accounts[0],
        input.transactions,
        cash.entries,
        "2026-01-04",
      ),
    ).toBe(0n);
  });

  it("puts cards, overdrafts and borrowed money in liabilities", () => {
    const cash: CashInput = {
      ...none,
      wallets: [
        wallet("a", 100n),
        wallet("card", -30n),
        { ...wallet("hidden", 999n), includeInNetWorth: false },
      ],
      debts: [
        { id: "l", direction: "lent", principal: 20n, startOn: "2026-01-01" },
        {
          id: "b",
          direction: "borrowed",
          principal: 50n,
          startOn: "2026-01-01",
        },
      ],
    };
    expect(cashPosition(base, cash, "2026-01-02")).toEqual({
      cash: 100n,
      receivable: 20n,
      liability: 80n,
    });
    expect(fullNetWorthAt(base, cash, "2026-01-02").total).toBe(40n);
  });

  it("does not change net worth when borrowing or paying a card", () => {
    const cash: CashInput = {
      ...none,
      wallets: [wallet("bank", 100n), wallet("card", -30n)],
      debts: [
        {
          id: "b",
          direction: "borrowed",
          principal: 50n,
          startOn: "2026-01-02",
        },
      ],
      entries: [
        e({
          type: "borrow",
          amount: 50n,
          occurredOn: "2026-01-02",
          walletId: "bank",
          debtId: "b",
        }),
        e({
          type: "transfer",
          amount: 30n,
          occurredOn: "2026-01-03",
          walletId: "bank",
          toWalletId: "card",
        }),
      ],
    };
    for (const d of ["2026-01-01", "2026-01-02", "2026-01-03"])
      expect(fullNetWorthAt(base, cash, d).total).toBe(70n);
  });

  it("ignores deposit/withdraw in the investment return", () => {
    const input: PortfolioInput = {
      ...base,
      transactions: [
        tx({
          type: "deposit",
          quantity: q("1000"),
          price: 10_000n,
          tradeDate: "2026-01-11",
        }),
        tx({
          type: "buy",
          quantity: q("1000"),
          price: 10_000n,
          tradeDate: "2026-01-12",
        }),
      ],
    };
    expect(periodChange(input, "2026-01-05", "2026-01-31")).toMatchObject({
      netFlow: 10_000_000n,
      gain: 0n,
    });
  });

  it("explains every change in net worth, day by day and over the whole period", () => {
    const input: PortfolioInput = {
      ...base,
      transactions: [
        tx({
          type: "buy",
          quantity: q("500"),
          price: 9_000n,
          tradeDate: "2026-01-03",
        }),
        tx({
          type: "buy",
          quantity: q("1000"),
          price: 10_000n,
          fee: 15_000n,
          tradeDate: "2026-01-12",
        }),
        tx({
          type: "dividend_cash",
          quantity: q("1500"),
          price: 500n,
          tax: 37_500n,
          tradeDate: "2026-02-01",
        }),
        tx({
          type: "sell",
          quantity: q("300"),
          price: 11_000n,
          fee: 4_000n,
          tax: 3_300n,
          tradeDate: "2026-02-12",
        }),
        tx({
          type: "buy",
          accountId: "SSI",
          quantity: q("10"),
          price: 10_500n,
          tradeDate: "2026-02-13",
        }),
      ],
      savings: [
        {
          principal: 50_000_000n,
          rateBps: 600,
          termMonths: 1,
          startDate: "2026-01-10",
          interestType: "end_of_term",
          rollover: "principal",
          status: "withdrawn",
          closedDate: "2026-02-20",
          closedAmount: 50_030_000n,
        },
        {
          principal: 20_000_000n,
          rateBps: 500,
          termMonths: 6,
          startDate: "2026-01-20",
          interestType: "end_of_term",
          rollover: "none",
          status: "active",
          closedDate: null,
        },
      ],
    };
    const cash: CashInput = {
      wallets: [
        wallet("bank", 200_000_000n),
        { ...wallet("card", -1_000_000n), openingDate: "2026-01-15" },
        { ...wallet("hidden"), includeInNetWorth: false },
      ],
      accounts: [
        { id: "DNSE", cashOpening: 2_000_000n, cashFrom: "2026-01-10" },
      ],
      debts: [
        {
          id: "l",
          direction: "lent",
          principal: 3_000_000n,
          startOn: "2026-01-21",
        },
        {
          id: "old",
          direction: "borrowed",
          principal: 5_000_000n,
          startOn: "2026-01-22",
        },
      ],
      entries: [
        e({
          type: "transfer",
          amount: 12_000_000n,
          occurredOn: "2026-01-11",
          walletId: "bank",
          toAccountId: "DNSE",
          direction: "out",
        }),
        e({
          type: "transfer",
          amount: 1_000_000n,
          occurredOn: "2026-01-11",
          walletId: "bank",
          toAccountId: "SSI",
          direction: "out",
        }),
        e({
          type: "transfer",
          amount: 50_000_000n,
          occurredOn: "2026-01-10",
          walletId: "bank",
          savingsDepositId: "s",
          direction: "out",
        }),
        e({
          type: "transfer",
          amount: 50_030_000n,
          occurredOn: "2026-02-20",
          walletId: "bank",
          savingsDepositId: "s",
          direction: "in",
        }),
        e({
          type: "income",
          amount: 30_000_000n,
          occurredOn: "2026-01-25",
          walletId: "bank",
          categoryId: "x",
        }),
        e({
          type: "expense",
          amount: 700_000n,
          occurredOn: "2026-01-26",
          walletId: "card",
          categoryId: "y",
        }),
        e({
          type: "expense",
          amount: 99_000n,
          occurredOn: "2026-01-26",
          walletId: "bank",
          categoryId: "y",
          excludeFromReport: true,
        }),
        e({
          type: "adjustment",
          amount: 5_000n,
          occurredOn: "2026-01-27",
          walletId: "bank",
          direction: "out",
        }),
        e({
          type: "transfer",
          amount: 400_000n,
          occurredOn: "2026-01-28",
          walletId: "bank",
          toWalletId: "hidden",
        }),
        e({
          type: "lend",
          amount: 3_000_000n,
          occurredOn: "2026-01-21",
          walletId: "bank",
          debtId: "l",
        }),
        e({
          type: "collect",
          amount: 1_000_000n,
          occurredOn: "2026-02-21",
          walletId: "bank",
          debtId: "l",
        }),
        e({
          type: "repay",
          amount: 2_000_000n,
          occurredOn: "2026-02-22",
          walletId: "bank",
          debtId: "old",
        }),
      ],
    };
    const explain = (from: string, to: string) => {
      const c = wealthChange(input, cash, from, to);
      expect(c.end - c.start).toBe(
        c.investmentGain +
          c.income -
          c.expense +
          c.openings +
          c.adjustments +
          c.external,
      );
      return c;
    };
    const whole = explain("2025-12-31", "2026-03-15");
    expect(whole).toMatchObject({
      income: 30_000_000n,
      expense: 700_000n,
      openings: 201_000_000n,
      adjustments: -104_000n,
    });
    for (
      let d = new Date("2025-12-31T00:00:00Z");
      d < new Date("2026-03-15T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const next = new Date(d.getTime() + 86_400_000);
      explain(d.toISOString().slice(0, 10), next.toISOString().slice(0, 10));
    }
    // Fully linked flows are not "external": a tracked broker trade nets to zero.
    expect(explain("2026-01-11", "2026-01-12").external).toBe(0n);
    expect(explain("2026-02-19", "2026-02-20").external).toBe(0n);
  });
});
