import { describe, expect, it } from "vitest";
import { parseDecimal as q } from "./decimal";
import {
  classSnapshot,
  netWorthAt,
  periodChange,
  priceAt,
  type PortfolioInput,
} from "./valuation";
import type { CalcTransaction } from "./types";

const series = new Map([
  [
    "HPG",
    [
      { date: "2026-01-02", price: 20_000n },
      { date: "2026-01-05", price: 21_000n },
      { date: "2026-02-02", price: 25_000n },
    ],
  ],
]);

describe("priceAt", () => {
  it("returns the latest price on or before the date (carry-forward)", () => {
    expect(priceAt(series, "HPG", "2026-01-04")).toEqual({
      date: "2026-01-02",
      price: 20_000n,
    });
    expect(priceAt(series, "HPG", "2026-01-05")?.price).toBe(21_000n);
    expect(priceAt(series, "HPG", "2027-01-01")?.price).toBe(25_000n);
    expect(priceAt(series, "HPG", "2025-12-31")).toBeNull();
    expect(priceAt(series, "XXX", "2026-01-05")).toBeNull();
  });
});

function t(
  p: Partial<CalcTransaction> & Pick<CalcTransaction, "type" | "tradeDate">,
): CalcTransaction {
  return {
    id: Math.random().toString(),
    instrumentId: "HPG",
    quantity: 0n,
    price: 0n,
    fee: 0n,
    tax: 0n,
    ...p,
  };
}

const input: PortfolioInput = {
  transactions: [
    t({
      type: "buy",
      quantity: q("1000"),
      price: 20_000n,
      tradeDate: "2026-01-02",
    }),
  ],
  assetClassOf: () => "stock",
  prices: series,
  savings: [
    {
      principal: 100_000_000n,
      rateBps: 365,
      termMonths: 12,
      startDate: "2026-01-01",
      interestType: "end_of_term",
      rollover: "none",
      status: "active",
      closedDate: null,
    },
  ],
};

describe("netWorthAt", () => {
  it("sums holdings at market price and savings with accrued interest", () => {
    const nw = netWorthAt(input, "2026-01-05");
    expect(nw.byClass.stock).toBe(21_000_000n);
    expect(nw.byClass.savings).toBe(100_000_000n + 40_000n);
    expect(nw.total).toBe(121_040_000n);
  });

  it("values a holding at cost when no price exists yet", () => {
    const noPrice: PortfolioInput = { ...input, prices: new Map() };
    expect(netWorthAt(noPrice, "2026-01-05").byClass.stock).toBe(20_000_000n);
  });
});

describe("periodChange", () => {
  it("excludes contributions from the gain (simple Dietz)", () => {
    const withBuy: PortfolioInput = {
      ...input,
      savings: [],
      transactions: [
        ...input.transactions,
        t({
          type: "buy",
          quantity: q("1000"),
          price: 21_000n,
          tradeDate: "2026-01-10",
        }),
      ],
    };
    const c = periodChange(withBuy, "2026-01-05", "2026-02-02");
    expect(c.startValue).toBe(21_000_000n);
    expect(c.endValue).toBe(50_000_000n);
    expect(c.netFlow).toBe(21_000_000n);
    expect(c.gain).toBe(8_000_000n);
    expect(c.ratio).toBeCloseTo(8 / 31.5, 6);
  });
});

describe("classSnapshot", () => {
  it("reports market value and cost basis per class", () => {
    const s = classSnapshot(input, "2026-01-05");
    expect(s.stock).toEqual({
      marketValue: 21_000_000n,
      costBasis: 20_000_000n,
    });
    expect(s.savings).toEqual({
      marketValue: 100_040_000n,
      costBasis: 100_000_000n,
    });
    expect(s.gold).toEqual({ marketValue: 0n, costBasis: 0n });
  });

  it("is empty before anything was bought", () => {
    const s = classSnapshot(input, "2025-12-01");
    expect(s.stock.marketValue + s.savings.marketValue).toBe(0n);
  });
});

describe("savings returns", () => {
  const dep = {
    principal: 100_000_000n,
    rateBps: 600,
    termMonths: 6,
    startDate: "2026-01-01",
    interestType: "end_of_term" as const,
    rollover: "none" as const,
    status: "active" as const,
    closedDate: null,
  };
  const book = (p: Partial<PortfolioInput["savings"][number]>) => ({
    ...input,
    transactions: [],
    savings: [{ ...dep, ...p }],
  });
  const FULL = 2_975_342n; // 181 days

  it("keeps the interest paid out on a principal-only rollover", () => {
    const c = periodChange(
      book({ rollover: "principal" }),
      "2026-01-01",
      "2026-07-01",
    );
    expect(c.gain).toBe(FULL);
  });

  it("includes the last day's interest when a book is closed at maturity", () => {
    const closed = book({ status: "withdrawn", closedDate: "2026-07-01" });
    expect(periodChange(closed, "2026-01-01", "2026-07-05").gain).toBe(FULL);
  });

  it("uses the amount actually received when closed early", () => {
    const closed = book({
      status: "withdrawn",
      closedDate: "2026-03-01",
      closedAmount: 100_010_000n,
    });
    expect(periodChange(closed, "2026-01-01", "2026-07-05").gain).toBe(10_000n);
  });

  it("pays out rollover interest once when the book is closed on a maturity date", () => {
    const closed = book({
      rollover: "principal",
      status: "withdrawn",
      closedDate: "2026-07-01",
    });
    expect(periodChange(closed, "2026-01-01", "2026-12-31").gain).toBe(FULL);
  });
});
