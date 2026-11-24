import { describe, expect, it } from "vitest";
import { mulQty, parseDecimal } from "../decimal";
import { computeHoldings } from "../holdings";
import type { CalcTransaction, TxType } from "../types";
import { FUND_CATALOG } from "./catalog";
import { fundLots, fundPosition, fundSale } from "./lots";
import {
  freeOfChargesOn,
  holdingTaxBps,
  monthsHeld,
  scheduleAt,
  tierAt,
  tierStart,
  type FeeTier,
  type FundTax,
} from "./schedule";
import { fromHundreds, navToPrice, priceToNav, toHundreds } from "./units";

const TAX: FundTax = { bps: 10, freeMonths: 24 };
const VMEEF = FUND_CATALOG.VMEEF.sell;
const AIF = FUND_CATALOG["VCBF-AIF"].sell;
const u = (ccq: string) => toHundreds(parseDecimal(ccq));

let n = 0;
const tx = (
  type: TxType,
  date: string,
  ccq: string,
  nav: string,
  over: Partial<CalcTransaction> = {},
): CalcTransaction => ({
  id: `t${n++}`,
  instrumentId: "f",
  type,
  quantity: u(ccq),
  price: navToPrice(nav),
  fee: 0n,
  tax: 0n,
  tradeDate: date,
  ...over,
});

describe("units", () => {
  it("stores hundreds of CCQ and an integer price per 100 CCQ", () => {
    expect(u("123.45")).toBe(parseDecimal("1.2345"));
    expect(fromHundreds(u("123.45"))).toBe(parseDecimal("123.45"));
    expect(navToPrice("12345.67")).toBe(1_234_567n);
    expect(navToPrice("15072.3")).toBe(1_507_230n);
    expect(priceToNav(1_507_230n)).toBe("15072.30");
    expect(priceToNav(5n)).toBe("0.05");
  });
  it("values a trade to the same đồng as units × NAV", () => {
    expect(mulQty(u("10.55"), navToPrice("10000.01"))).toBe(105_500n);
    expect(mulQty(u("0.01"), navToPrice("15050.00"))).toBe(151n);
  });
  it("rejects a NAV with more than two decimals", () => {
    expect(() => navToPrice("1.005")).toThrow();
  });
});

describe("fee tiers", () => {
  const bps = (tiers: readonly FeeTier[], bought: string, on: string) =>
    tierAt(tiers, bought, on)!.feeBps;

  it("VMEEF drops on the anniversary", () => {
    expect(bps(VMEEF, "2025-10-29", "2025-10-29")).toBe(200);
    expect(bps(VMEEF, "2025-10-29", "2026-10-28")).toBe(200);
    expect(bps(VMEEF, "2025-10-29", "2026-10-29")).toBe(100);
    expect(bps(VMEEF, "2025-10-29", "2027-10-28")).toBe(100);
    expect(bps(VMEEF, "2025-10-29", "2027-10-29")).toBe(0);
  });
  it("VCBF-AIF drops the day after the anniversary", () => {
    expect(bps(AIF, "2025-10-30", "2025-11-30")).toBe(300);
    expect(bps(AIF, "2025-10-30", "2025-12-01")).toBe(200);
    expect(bps(AIF, "2025-10-30", "2026-10-30")).toBe(200);
    expect(bps(AIF, "2025-10-30", "2026-10-31")).toBe(50);
    expect(bps(AIF, "2025-10-30", "2027-10-30")).toBe(50);
    expect(bps(AIF, "2025-10-30", "2027-10-31")).toBe(0);
  });
  it("clamps to the last day of short months", () => {
    expect(tierStart("2025-01-31", AIF[1])).toBe("2025-03-01");
    expect(tierStart("2024-02-29", VMEEF[1])).toBe("2025-02-28");
    expect(tierStart("2026-02-28", VMEEF[2])).toBe("2028-02-28");
  });
  it("counts full months", () => {
    expect(monthsHeld("2025-01-31", "2025-02-27")).toBe(0);
    expect(monthsHeld("2025-01-31", "2025-02-28")).toBe(1);
    expect(monthsHeld("2025-10-29", "2026-10-28")).toBe(11);
    expect(monthsHeld("2025-10-29", "2026-10-29")).toBe(12);
  });
  it("uses the schedule in force on the sale date", () => {
    const row = (effectiveFrom: string, feeBps: number) => ({
      effectiveFrom,
      fromMonths: 0,
      fromInclusive: true,
      feeBps,
    });
    const rows = [row("2027-01-01", 300), row("2026-01-01", 200)];
    expect(scheduleAt(rows, "2026-12-31")[0].feeBps).toBe(200);
    expect(scheduleAt(rows, "2027-01-01")[0].feeBps).toBe(300);
    // Nothing is known before the first schedule: use the earliest one.
    expect(scheduleAt(rows, "2025-01-01")[0].feeBps).toBe(200);
    expect(scheduleAt([], "2025-01-01")).toEqual([]);
  });
});

describe("tax", () => {
  it("is waived from two full years on, for sales from 01/07/2026", () => {
    expect(holdingTaxBps("2025-01-24", "2027-01-23", TAX)).toBe(10);
    expect(holdingTaxBps("2025-01-24", "2027-01-24", TAX)).toBe(0);
    expect(holdingTaxBps("2024-06-30", "2026-06-30", TAX)).toBe(10);
    expect(holdingTaxBps("2024-06-30", "2026-07-01", TAX)).toBe(0);
  });
  it("waits for the later of the fee and the tax", () => {
    expect(freeOfChargesOn("2025-10-29", VMEEF, TAX)).toBe("2027-10-29");
    expect(freeOfChargesOn("2025-10-30", AIF, TAX)).toBe("2027-10-31");
    expect(freeOfChargesOn("2025-10-30", [], TAX)).toBeNull();
  });
});

describe("fundLots", () => {
  it("consumes lots first in, first out and keeps the rest of a partial lot", () => {
    const txs = [
      tx("buy", "2025-03-01", "50", "20000"),
      tx("buy", "2025-01-01", "100", "10000", { fee: 1_000n }),
      tx("sell", "2025-06-01", "120", "15000"),
    ];
    const lots = fundLots(txs);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      date: "2025-03-01",
      quantity: u("30"),
      cost: 600_000n,
    });
    expect(fundLots(txs, "2025-05-31")).toHaveLength(2);
    expect(fundLots(txs, "2025-05-31")[0].cost).toBe(1_001_000n);
  });
  it("rejects selling more than is held", () => {
    expect(() =>
      fundLots([
        tx("buy", "2025-01-01", "1", "10000"),
        tx("sell", "2025-01-02", "1.01", "10000"),
      ]),
    ).toThrow();
  });
  it("agrees with the weighted average holding on units, and on cost before any sale", () => {
    const txs = [
      tx("buy", "2025-01-01", "12.34", "10123.45"),
      tx("buy", "2025-02-01", "56.78", "11987.65"),
    ];
    const h = computeHoldings(txs).get("f")!;
    const lots = fundLots(txs);
    expect(lots.reduce((s, l) => s + l.quantity, 0n)).toBe(h.quantity);
    expect(lots.reduce((s, l) => s + l.cost, 0n)).toBe(h.costBasis);
  });
});

describe("fundSale and fundPosition", () => {
  const txs = [
    tx("buy", "2024-01-10", "100", "10000"),
    tx("buy", "2025-06-10", "100", "12000"),
    tx("buy", "2026-06-10", "100", "14000"),
  ];
  const price = navToPrice("15000");

  it("charges each slice by its own age", () => {
    const sale = fundSale(
      fundLots(txs),
      u("250"),
      price,
      "2026-11-24",
      VMEEF,
      TAX,
    );
    // 1st lot: free; 2nd: 1% + 0,1%; half of the 3rd: 2% + 0,1%.
    expect(sale.gross).toBe(3_750_000n);
    expect(sale.fee).toBe(15_000n + 15_000n);
    expect(sale.tax).toBe(1_500n + 750n);
    expect(sale.net).toBe(3_750_000n - 32_250n);
  });
  it("summarises the position", () => {
    const pos = fundPosition(fundLots(txs), price, "2026-11-24", VMEEF, TAX);
    expect(pos.units).toBe(u("300"));
    expect(pos.cost).toBe(3_600_000n);
    expect(pos.value).toBe(4_500_000n);
    expect(pos.fee).toBe(45_000n);
    expect(pos.tax).toBe(3_000n);
    expect(pos.net).toBe(4_452_000n);
    expect(pos.pl).toBe(900_000n);
    expect(pos.netPl).toBe(852_000n);
    expect(pos.nextStepDown).toBe("2027-06-10");
    expect(pos.nextFree).toBe("2027-06-10");
    expect(pos.lots.map((l) => l.feeBps)).toEqual([0, 100, 200]);
    // Two years were up in January, but the tax waiver starts in July.
    expect(pos.lots[0].freeOn).toBe("2026-07-01");
  });
  it("handles an empty position", () => {
    const pos = fundPosition([], price, "2026-11-24", VMEEF, TAX);
    expect(pos).toMatchObject({ units: 0n, net: 0n, nextStepDown: null });
  });
  it("rejects selling more than the lots hold", () => {
    expect(() =>
      fundSale(fundLots(txs), u("300.01"), price, "2026-11-24", VMEEF, TAX),
    ).toThrow();
  });
});
