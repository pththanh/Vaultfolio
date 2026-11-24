import { describe, expect, it } from "vitest";
import { parseDecimal as q } from "./decimal";
import { fromChi, perChiToPerLuong, perLuongToPerChi, toChi } from "./gold";

describe("gold unit conversion (1 lượng = 10 chỉ = 37,5 g)", () => {
  it("converts to chỉ", () => {
    expect(toChi(q("2"), "luong")).toBe(q("20"));
    expect(toChi(q("10"), "chi")).toBe(q("10"));
    expect(toChi(q("37.5"), "gram")).toBe(q("10"));
    expect(toChi(q("3.75"), "gram")).toBe(q("1"));
  });

  it("converts from chỉ", () => {
    expect(fromChi(q("20"), "luong")).toBe(q("2"));
    expect(fromChi(q("1"), "gram")).toBe(q("3.75"));
    expect(fromChi(q("5"), "luong")).toBe(q("0.5"));
  });

  it("round-trips through grams", () => {
    expect(toChi(fromChi(q("7"), "gram"), "gram")).toBe(q("7"));
  });

  it("converts prices between per chỉ and per lượng", () => {
    expect(perChiToPerLuong(14_650_000n)).toBe(146_500_000n);
    expect(perLuongToPerChi(153_000_000n)).toBe(15_300_000n);
    expect(perLuongToPerChi(146_500_005n)).toBe(14_650_001n);
  });
});
