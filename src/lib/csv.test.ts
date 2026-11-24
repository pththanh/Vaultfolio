import { describe, expect, it } from "vitest";
import {
  CSV_HEADER,
  parseTransactionsCsv,
  toSnapshotsCsv,
  toTransactionsCsv,
} from "./csv";

describe("transactions CSV", () => {
  it("round-trips rows", () => {
    const csv = toTransactionsCsv([
      {
        date: "2026-11-18",
        type: "buy",
        assetClass: "stock",
        symbol: "HPG",
        account: "DNSE",
        quantity: "1000",
        price: 26_950n,
        fee: 40_425n,
        tax: 0n,
        note: 'Mua thêm, "lô lẻ"',
      },
    ]);
    expect(csv.split("\n")[0]).toBe(CSV_HEADER.join(","));
    const parsed = parseTransactionsCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        line: 2,
        date: "2026-11-18",
        type: "buy",
        assetClass: "stock",
        symbol: "HPG",
        account: "DNSE",
        quantity: "1000",
        price: 26_950n,
        fee: 40_425n,
        tax: 0n,
        note: 'Mua thêm, "lô lẻ"',
      },
    ]);
  });

  it("shows funds as CCQ and NAV, and stores them per 100 CCQ", () => {
    const row = {
      date: "2026-01-02",
      type: "buy" as const,
      assetClass: "fund" as const,
      symbol: "VMEEF",
      account: "Fmarket",
      quantity: "0.105",
      price: 1_000_002n,
      fee: 0n,
      tax: 0n,
      note: "",
    };
    const csv = toTransactionsCsv([row]);
    expect(csv).toContain("VMEEF,Fmarket,10.5,10000.02,0,0,");
    expect(parseTransactionsCsv(csv).rows).toEqual([{ ...row, line: 2 }]);
    const bad = parseTransactionsCsv(csv.replace(",buy,", ",bonus_share,"));
    expect(bad.errors[0].message).toMatch(/mua và bán/);
  });

  it("reports invalid rows with line numbers and keeps valid ones", () => {
    const csv = [
      CSV_HEADER.join(","),
      "2026-01-02,buy,crypto,BTC,Ví Binance,0.065,2150000000,139750,0,",
      "02/01/2026,buy,stock,FPT,DNSE,100,1,0,0,",
      "2026-01-02,steal,stock,FPT,DNSE,100,1,0,0,",
      "2026-01-02,buy,savings,X,Bank,1,1,0,0,",
      "2026-01-02,buy,stock,,DNSE,1,1,0,0,",
      "2026-01-02,buy,stock,FPT,DNSE,abc,1,0,0,",
    ].join("\n");
    const parsed = parseTransactionsCsv(csv);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].quantity).toBe("0.065");
    expect(parsed.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7]);
  });

  it("requires the header", () => {
    expect(parseTransactionsCsv("a,b,c\n1,2,3").errors[0].message).toMatch(
      /Thiếu cột/,
    );
  });
});

describe("snapshots CSV", () => {
  it("writes one row per date with class values, totals and VN-Index", () => {
    const csv = toSnapshotsCsv([
      {
        date: "2026-11-20",
        byClass: {
          stock: { marketValue: 100n, costBasis: 90n },
          savings: { marketValue: 50n, costBasis: 50n },
          fund: { marketValue: 20n, costBasis: 25n },
          gold: { marketValue: 0n, costBasis: 0n },
          crypto: { marketValue: 10n, costBasis: 12n },
        },
        cash: 40n,
        receivable: 5n,
        liability: -7n,
        vnIndex: 168_879n,
      },
    ]);
    expect(csv.split("\n")).toEqual([
      "date,stock,savings,fund,gold,crypto,cash,receivable,liability,total,cost_basis,vnindex",
      "2026-11-20,100,50,20,0,10,40,5,-7,218,177,1688.79",
    ]);
  });
});

describe("CSV formula injection", () => {
  it("neutralises text cells that spreadsheets would run as formulas, and restores them on import", () => {
    const csv = toTransactionsCsv([
      {
        date: "2026-01-02",
        type: "buy",
        assetClass: "stock",
        symbol: "FPT",
        account: "@DNSE",
        quantity: "1",
        price: 1n,
        fee: 0n,
        tax: 0n,
        note: '=HYPERLINK("http://evil")',
      },
    ]);
    expect(csv).toContain(`'@DNSE`);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    const back = parseTransactionsCsv(csv).rows[0];
    expect(back.account).toBe("@DNSE");
    expect(back.note).toBe('=HYPERLINK("http://evil")');
  });
});
