import { describe, expect, it } from "vitest";
import { parseDecimal as q } from "./decimal";
import {
  CalcError,
  averageCost,
  cashFlow,
  computeHoldings,
  realizedEvents,
  unrealized,
} from "./holdings";
import type { CalcTransaction } from "./types";

let seq = 0;
function tx(
  partial: Partial<CalcTransaction> & Pick<CalcTransaction, "type">,
): CalcTransaction {
  seq += 1;
  return {
    id: `t${seq}`,
    instrumentId: "FPT",
    quantity: 0n,
    price: 0n,
    fee: 0n,
    tax: 0n,
    tradeDate: "2026-01-01",
    ...partial,
  };
}

describe("computeHoldings — weighted average cost", () => {
  it("accumulates buys including fees into cost basis", () => {
    const h = computeHoldings([
      tx({ type: "buy", quantity: q("1000"), price: 100_000n, fee: 150_000n }),
      tx({
        type: "buy",
        quantity: q("1000"),
        price: 120_000n,
        fee: 180_000n,
        tradeDate: "2026-02-01",
      }),
    ]).get("FPT")!;
    expect(h.quantity).toBe(q("2000"));
    expect(h.costBasis).toBe(220_330_000n);
    expect(averageCost(h)).toBe(110_165n);
  });

  it("sell realizes P/L against the average cost and keeps the average unchanged", () => {
    const h = computeHoldings([
      tx({ type: "buy", quantity: q("1000"), price: 100_000n }),
      tx({ type: "buy", quantity: q("1000"), price: 120_000n }),
      tx({
        type: "sell",
        quantity: q("500"),
        price: 130_000n,
        fee: 97_500n,
        tax: 65_000n,
      }),
    ]).get("FPT")!;
    expect(h.quantity).toBe(q("1500"));
    expect(h.costBasis).toBe(165_000_000n);
    expect(averageCost(h)).toBe(110_000n);
    // proceeds 65.000.000 − 162.500 − cost 55.000.000
    expect(h.realizedPnl).toBe(9_837_500n);
  });

  it("selling everything zeroes cost exactly (no rounding residue)", () => {
    const h = computeHoldings([
      tx({ type: "buy", quantity: q("3"), price: 100n }),
      tx({ type: "buy", quantity: q("3"), price: 101n }),
      tx({ type: "sell", quantity: q("2"), price: 105n }),
      tx({ type: "sell", quantity: q("4"), price: 105n }),
    ]).get("FPT")!;
    expect(h.quantity).toBe(0n);
    expect(h.costBasis).toBe(0n);
    expect(h.realizedPnl).toBe(630n - 603n);
  });

  it("throws when selling more than held", () => {
    expect(() =>
      computeHoldings([
        tx({ type: "buy", quantity: q("10"), price: 1n }),
        tx({ type: "sell", quantity: q("11"), price: 1n }),
      ]),
    ).toThrow(CalcError);
  });

  it("sorts by trade date before processing", () => {
    const h = computeHoldings([
      tx({
        type: "sell",
        quantity: q("10"),
        price: 2n,
        tradeDate: "2026-03-01",
      }),
      tx({
        type: "buy",
        quantity: q("10"),
        price: 1n,
        tradeDate: "2026-01-01",
      }),
    ]).get("FPT")!;
    expect(h.quantity).toBe(0n);
    expect(h.realizedPnl).toBe(10n);
  });

  it("respects asOf", () => {
    const txs = [
      tx({
        type: "buy",
        quantity: q("10"),
        price: 1n,
        tradeDate: "2026-01-01",
      }),
      tx({
        type: "buy",
        quantity: q("10"),
        price: 1n,
        tradeDate: "2026-06-01",
      }),
    ];
    expect(
      computeHoldings(txs, { asOf: "2026-03-01" }).get("FPT")!.quantity,
    ).toBe(q("10"));
  });
});

describe("corporate actions", () => {
  it("cash dividend is income net of tax and does not change cost", () => {
    const h = computeHoldings([
      tx({ type: "buy", quantity: q("3000"), price: 88_000n }),
      tx({
        type: "dividend_cash",
        quantity: q("3000"),
        price: 1_000n,
        tax: 150_000n,
      }),
    ]).get("FPT")!;
    expect(h.costBasis).toBe(264_000_000n);
    expect(h.dividendIncome).toBe(2_850_000n);
    expect(h.quantity).toBe(q("3000"));
  });

  it("stock dividend and bonus shares add quantity at zero cost, lowering the average", () => {
    const h = computeHoldings([
      tx({ type: "buy", quantity: q("2000"), price: 115_000n }),
      tx({ type: "bonus_share", quantity: q("300") }),
      tx({ type: "dividend_stock", quantity: q("115") }),
    ]).get("FPT")!;
    expect(h.quantity).toBe(q("2415"));
    expect(h.costBasis).toBe(230_000_000n);
    expect(averageCost(h)).toBe(95_238n);
  });

  it("standalone fee is a realized loss; interest is income", () => {
    const h = computeHoldings([
      tx({ type: "buy", quantity: q("1"), price: 1_000n }),
      tx({ type: "fee", fee: 50n }),
      tx({ type: "interest", quantity: q("1"), price: 30n, tax: 3n }),
    ]).get("FPT")!;
    expect(h.realizedPnl).toBe(-50n);
    expect(h.dividendIncome).toBe(27n);
  });
});

describe("cashFlow (investor perspective: negative = money paid in)", () => {
  it("covers each type", () => {
    expect(
      cashFlow(
        tx({ type: "buy", quantity: q("1000"), price: 26_950n, fee: 40_425n }),
      ),
    ).toBe(-26_990_425n);
    expect(
      cashFlow(
        tx({
          type: "sell",
          quantity: q("2000"),
          price: 31_200n,
          fee: 93_600n,
          tax: 62_400n,
        }),
      ),
    ).toBe(62_244_000n);
    expect(
      cashFlow(
        tx({
          type: "dividend_cash",
          quantity: q("3000"),
          price: 1_000n,
          tax: 150_000n,
        }),
      ),
    ).toBe(2_850_000n);
    expect(cashFlow(tx({ type: "bonus_share", quantity: q("260") }))).toBe(0n);
    expect(
      cashFlow(tx({ type: "deposit", quantity: q("1"), price: 100n })),
    ).toBe(-100n);
    expect(
      cashFlow(tx({ type: "withdraw", quantity: q("1"), price: 100n })),
    ).toBe(100n);
    expect(cashFlow(tx({ type: "fee", fee: 7n }))).toBe(-7n);
  });
});

describe("unrealized", () => {
  it("returns amount and ratio", () => {
    const h = computeHoldings([
      tx({ type: "buy", quantity: q("5000"), price: 61_200n }),
    ]).get("FPT")!;
    const u = unrealized(h, 69_740n);
    expect(u.marketValue).toBe(348_700_000n);
    expect(u.amount).toBe(42_700_000n);
    expect(u.ratio).toBeCloseTo(0.1395, 4);
  });
});

describe("realizedEvents", () => {
  it("lists realized trade P/L, income and fees with dates", () => {
    const events = realizedEvents([
      tx({
        type: "buy",
        quantity: q("1000"),
        price: 100_000n,
        tradeDate: "2025-12-01",
      }),
      tx({
        type: "dividend_cash",
        quantity: q("1000"),
        price: 2_000n,
        tax: 100_000n,
        tradeDate: "2025-12-20",
      }),
      tx({
        type: "sell",
        quantity: q("400"),
        price: 110_000n,
        fee: 66_000n,
        tax: 44_000n,
        tradeDate: "2026-02-01",
      }),
      tx({ type: "fee", fee: 5_000n, tradeDate: "2026-03-01" }),
      tx({ type: "bonus_share", quantity: q("100"), tradeDate: "2026-04-01" }),
    ]);
    expect(events.map((e) => [e.date, e.kind, e.amount])).toEqual([
      ["2025-12-20", "income", 1_900_000n],
      ["2026-02-01", "trade", 3_890_000n],
      ["2026-03-01", "fee", -5_000n],
    ]);
  });
});
