import { describe, expect, it } from "vitest";
import { parseDnseOhlc, parseVcbUsd } from "./parse";

describe("parseDnseOhlc", () => {
  it("maps bars to VN dates and scales stock prices from thousands", () => {
    // 2026-11-20 00:00 UTC, and 2026-11-20 17:00 UTC (= 00:00 on 21/11 in Vietnam)
    const bars = parseDnseOhlc(
      { t: [1795132800, 1795194000], c: [45, 20.45] },
      1000,
    );
    expect(bars).toEqual([
      { date: "2026-11-20", close: 45_000n },
      { date: "2026-11-21", close: 20_450n },
    ]);
  });

  it("scales index points to hundredths", () => {
    expect(parseDnseOhlc({ t: [1795132800], c: [1688.79] }, 100)[0].close).toBe(
      168_879n,
    );
  });

  it("rejects malformed bodies", () => {
    expect(() => parseDnseOhlc({ s: "error" }, 1000)).toThrow();
  });
});

describe("parseVcbUsd", () => {
  it("reads the transfer rate", () => {
    const xml = `<ExrateList><DateTime>11/22/2026 11:49:40 PM</DateTime>
      <Exrate CurrencyCode="USD" CurrencyName="US DOLLAR" Buy="25,570.00" Transfer="25,600.00" Sell="25,980.00" /></ExrateList>`;
    expect(parseVcbUsd(xml)).toBe("25600.00");
  });

  it("throws when USD is missing", () => {
    expect(() => parseVcbUsd("<ExrateList />")).toThrow();
  });
});
