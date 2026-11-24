import { describe, expect, it } from "vitest";
import { parseDecimal as q } from "./calc/decimal";
import {
  formatDate,
  formatDateTimeShort,
  formatInt,
  formatLongDate,
  formatPct,
  formatQty,
  formatShortVnd,
  formatSignedVnd,
  formatVnd,
  trend,
  NBSP,
} from "./format";

describe("vi-VN number formatting", () => {
  it("formats integers and VND", () => {
    expect(formatInt(2_486_500_000n)).toBe("2.486.500.000");
    expect(formatVnd(2_486_500_000n)).toBe(`2.486.500.000${NBSP}₫`);
    expect(formatVnd(0n)).toBe(`0${NBSP}₫`);
    expect(formatInt(-26_990_425n)).toBe("−26.990.425");
  });

  it("formats signed amounts with a real minus sign", () => {
    expect(formatSignedVnd(12_400_000n)).toBe(`+12.400.000${NBSP}₫`);
    expect(formatSignedVnd(-26_990_425n)).toBe(`−26.990.425${NBSP}₫`);
    expect(formatSignedVnd(0n)).toBe(`0${NBSP}₫`);
  });

  it("formats percentages with comma decimals", () => {
    expect(formatPct(0.005)).toBe("0,50%");
    expect(formatPct(0.032, { digits: 1, signed: true })).toBe("+3,2%");
    expect(formatPct(-0.16, { digits: 1, signed: true })).toBe("−16,0%");
    expect(formatPct(null)).toBe("—");
  });

  it("formats quantities with up to 8 decimals", () => {
    expect(formatQty(q("5000"))).toBe("5.000");
    expect(formatQty(q("0.065"))).toBe("0,065");
    expect(formatQty(q("0.00000001"))).toBe("0,00000001");
  });

  it("formats short amounts", () => {
    expect(formatShortVnd(2_486_500_000n)).toBe("2,49 tỷ");
    expect(formatShortVnd(1_120_000_000n)).toBe("1,12 tỷ");
    expect(formatShortVnd(220_500_000n)).toBe("220,5 tr");
    expect(formatShortVnd(950_000n)).toBe("950.000");
  });

  it("trend picks arrow and tone, never color alone", () => {
    expect(trend(1n)).toEqual({ arrow: "▲", tone: "gain" });
    expect(trend(-1)).toEqual({ arrow: "▼", tone: "loss" });
    expect(trend(0n)).toEqual({ arrow: "", tone: "flat" });
  });
});

describe("dates", () => {
  it("formats ISO dates", () => {
    expect(formatDate("2026-11-21")).toBe("21/11/2026");
    expect(formatLongDate("2026-11-21")).toBe("Thứ Bảy, 21/11/2026");
    expect(formatLongDate("2026-11-22")).toBe("Chủ Nhật, 22/11/2026");
  });

  it("formats timestamps in Vietnam time", () => {
    expect(formatDateTimeShort(new Date("2026-11-20T08:32:00Z"))).toBe(
      "20/11 15:32",
    );
  });
});
