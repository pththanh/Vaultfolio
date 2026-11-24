import { describe, expect, it } from "vitest";
import {
  QTY_SCALE,
  divRound,
  mulQty,
  parseDecimal,
  parseViNumber,
  qtyToString,
  qtyToNumber,
  ratio,
} from "./decimal";

describe("parseDecimal (canonical, dot decimal)", () => {
  it("parses integers and decimals into scaled bigint", () => {
    expect(parseDecimal("1000")).toBe(1000n * QTY_SCALE);
    expect(parseDecimal("0.065")).toBe(6_500_000n);
    expect(parseDecimal("0.00000001")).toBe(1n);
    expect(parseDecimal("-2.5")).toBe(-250_000_000n);
  });

  it("rounds digits beyond 8 decimals half-up", () => {
    expect(parseDecimal("0.000000015")).toBe(2n);
    expect(parseDecimal("0.000000014")).toBe(1n);
  });

  it("rejects garbage", () => {
    expect(() => parseDecimal("abc")).toThrow();
    expect(() => parseDecimal("")).toThrow();
    expect(() => parseDecimal("1.2.3")).toThrow();
  });
});

describe("parseViNumber (user input, vi-VN)", () => {
  it("treats comma as decimal and dot as thousands", () => {
    expect(parseViNumber("1.234.567")).toBe(1_234_567n * QTY_SCALE);
    expect(parseViNumber("0,065")).toBe(6_500_000n);
    expect(parseViNumber("1.234,5")).toBe(123_450_000_000n);
  });

  it("disambiguates a single dot", () => {
    expect(parseViNumber("26.950")).toBe(26_950n * QTY_SCALE);
    expect(parseViNumber("0.25")).toBe(25_000_000n);
    expect(parseViNumber("0.065")).toBe(6_500_000n);
    expect(parseViNumber("5.2")).toBe(520_000_000n);
  });

  it("ignores spaces and currency signs", () => {
    expect(parseViNumber(" 300.000.000 ₫ ")).toBe(300_000_000n * QTY_SCALE);
  });
});

describe("arithmetic", () => {
  it("divRound rounds half away from zero", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(() => divRound(1n, 0n)).toThrow();
  });

  it("mulQty multiplies a scaled quantity by a VND price", () => {
    expect(mulQty(parseDecimal("0.065"), 2_400_000_000n)).toBe(156_000_000n);
    expect(mulQty(parseDecimal("1000"), 26_950n)).toBe(26_950_000n);
    expect(mulQty(parseDecimal("0.333333333"), 10n)).toBe(3n);
  });

  it("formats quantities back to strings", () => {
    expect(qtyToString(parseDecimal("0.065"))).toBe("0.065");
    expect(qtyToString(parseDecimal("1000"))).toBe("1000");
    expect(qtyToString(parseDecimal("-0.5"))).toBe("-0.5");
    expect(qtyToNumber(parseDecimal("2.5"))).toBe(2.5);
  });

  it("ratio returns a float for display-only percentages", () => {
    expect(ratio(1n, 4n)).toBe(0.25);
    expect(ratio(1n, 0n)).toBeNull();
  });
});
