import { describe, expect, it } from "vitest";
import { MAX_DAILY_MOVE, reviewPrice } from "./validate";

describe("reviewPrice", () => {
  it("accepts normal moves", () => {
    expect(reviewPrice({ price: 105n, previous: 100n })).toEqual({
      needsReview: false,
      reason: null,
    });
    expect(reviewPrice({ price: 100n, previous: null })).toEqual({
      needsReview: false,
      reason: null,
    });
  });

  it("flags zero or negative prices", () => {
    expect(reviewPrice({ price: 0n, previous: 100n }).reason).toMatch(/giá 0/);
  });

  it(`flags moves beyond ±${MAX_DAILY_MOVE * 100}%`, () => {
    expect(reviewPrice({ price: 116n, previous: 100n }).needsReview).toBe(true);
    expect(reviewPrice({ price: 84n, previous: 100n }).reason).toMatch(
      /Lệch −16,0%/,
    );
    expect(reviewPrice({ price: 115n, previous: 100n }).needsReview).toBe(
      false,
    );
  });

  it("flags stock prices outside the ceiling/floor band", () => {
    const band = { floor: 19_050n, ceiling: 21_850n };
    expect(
      reviewPrice({ price: 21_850n, previous: 20_450n, band }).needsReview,
    ).toBe(false);
    expect(
      reviewPrice({ price: 21_900n, previous: 20_450n, band }).reason,
    ).toMatch(/trần\/sàn/);
  });
});
