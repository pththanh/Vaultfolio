import { describe, expect, it } from "vitest";
import { DEFAULT_FEE_CONFIG, tradeCharges } from "./fees";

describe("tradeCharges", () => {
  const cfg = DEFAULT_FEE_CONFIG;

  it("stock buy: broker fee only", () => {
    expect(tradeCharges("stock", "buy", 26_950_000n, cfg)).toEqual({
      fee: 40_425n,
      tax: 0n,
    });
  });

  it("stock sell: broker fee + sell tax", () => {
    expect(tradeCharges("stock", "sell", 62_400_000n, cfg)).toEqual({
      fee: 93_600n,
      tax: 62_400n,
    });
  });

  it("cash dividend: dividend tax", () => {
    expect(tradeCharges("stock", "dividend_cash", 3_000_000n, cfg)).toEqual({
      fee: 0n,
      tax: 150_000n,
    });
  });

  it("crypto uses its own fee rate and no tax", () => {
    expect(tradeCharges("crypto", "buy", 21_400_000n, cfg)).toEqual({
      fee: 21_400n,
      tax: 0n,
    });
    expect(tradeCharges("crypto", "sell", 21_400_000n, cfg)).toEqual({
      fee: 21_400n,
      tax: 0n,
    });
  });

  it("gold and corporate actions are free by default", () => {
    expect(tradeCharges("gold", "buy", 139_000_000n, cfg)).toEqual({
      fee: 0n,
      tax: 0n,
    });
    expect(tradeCharges("stock", "bonus_share", 0n, cfg)).toEqual({
      fee: 0n,
      tax: 0n,
    });
  });

  it("is configurable", () => {
    expect(
      tradeCharges("stock", "buy", 1_000_000n, { ...cfg, stockFeeBps: 30 }),
    ).toEqual({ fee: 3_000n, tax: 0n });
  });
});
