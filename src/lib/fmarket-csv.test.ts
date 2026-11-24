import { describe, expect, it } from "vitest";
import { navToPrice, toHundreds } from "./calc/fund/units";
import { parseDecimal } from "./calc/decimal";
import { orderKey, parseFmarketCsv } from "./fmarket-csv";

const HEAD =
  "order_date,match_date,fund,type,units,nav,value,fee,tax,program\r\n";
const ok =
  "2025-01-09,2025-01-10,VMEEF,BUY,10.50,10000.02,105000,0,0,Linh hoạt";
const parse = (...lines: string[]) =>
  parseFmarketCsv(`﻿${HEAD}${lines.join("\r\n")}\r\n`);

describe("parseFmarketCsv", () => {
  it("reads orders in stored units", () => {
    const { rows, errors } = parse(ok);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      line: 2,
      fund: "VMEEF",
      type: "buy",
      orderDate: "2025-01-09",
      matchDate: "2025-01-10",
      quantity: toHundreds(parseDecimal("10.5")),
      price: navToPrice("10000.02"),
      fee: 0n,
      program: "Linh hoạt",
    });
  });
  it("reports bad rows by line", () => {
    const bad = (from: string, to: string) =>
      parse(ok.replace(from, to)).errors[0]?.message ?? "";
    expect(bad("2025-01-10", "10/01/2025")).toMatch(/Ngày/);
    expect(bad("2025-01-10", "2025-02-30")).toMatch(/Ngày/);
    expect(bad("2025-01-10", "2025-01-08")).toMatch(/trước ngày đặt/);
    expect(bad("BUY", "SWAP")).toMatch(/Loại lệnh/);
    expect(bad("10.50", "0")).toMatch(/Số CCQ/);
    expect(bad("10000.02", "10000.023")).toMatch(/NAV/);
    expect(bad("105000", "106000")).toMatch(/không khớp/);
    expect(bad("VMEEF", "")).toMatch(/mã quỹ/);
  });
  it("names missing columns", () => {
    expect(parseFmarketCsv("fund,type\nA,BUY\n").errors[0].message).toMatch(
      /Thiếu cột/,
    );
  });
  it("keys duplicates by fund, match date, side and units", () => {
    const [a, b] = parse(ok, ok.replace("10.50", "10.5")).rows;
    expect(orderKey("f", a)).toBe(orderKey("f", b));
    expect(orderKey("f", a)).not.toBe(orderKey("g", a));
  });
});
