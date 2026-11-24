import { describe, expect, it } from "vitest";
import { parseFmarketNav } from "./parse";
import { FUND_MAX_MOVE, reviewPrice } from "./validate";

describe("parseFmarketNav", () => {
  it("returns prices per 100 CCQ by NAV date, oldest first", () => {
    expect(
      parseFmarketNav({
        data: [
          { navDate: "2026-11-23", nav: 14557.13 },
          { navDate: "2026-11-20", nav: 15072.3 },
          { navDate: "2026-11-23", nav: 14557.13 },
        ],
      }),
    ).toEqual([
      { date: "2026-11-20", close: 1_507_230n },
      { date: "2026-11-23", close: 1_455_713n },
    ]);
  });
  it("rejects malformed bodies", () => {
    expect(() => parseFmarketNav({ data: null })).toThrow(/không hợp lệ/);
    expect(() =>
      parseFmarketNav({ data: [{ navDate: "23/11/2026", nav: 1 }] }),
    ).toThrow(/không hợp lệ/);
    expect(() =>
      parseFmarketNav({ data: [{ navDate: "2026-11-23", nav: null }] }),
    ).toThrow(/không hợp lệ/);
  });
});

describe("fund review", () => {
  it("flags moves beyond ±10%", () => {
    const at = (price: bigint) =>
      reviewPrice({ price, previous: 1000n, maxMove: FUND_MAX_MOVE })
        .needsReview;
    expect([at(1100n), at(1101n), at(900n), at(899n)]).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });
});
