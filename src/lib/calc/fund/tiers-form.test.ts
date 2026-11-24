import { describe, expect, it } from "vitest";
import { tiersError } from "./schedule";

describe("tiersError", () => {
  const t = (fromMonths: number, feeBps = 0, fromInclusive = true) => ({
    fromMonths,
    fromInclusive,
    feeBps,
  });
  it("needs a first tier that covers the purchase day, and distinct starts", () => {
    expect(tiersError([t(0), t(12, 0, false)])).toBeNull();
    expect(tiersError([])).toMatch(/ít nhất/);
    expect(tiersError([t(1)])).toMatch(/0 tháng/);
    expect(tiersError([t(0, 0, false)])).toMatch(/0 tháng/);
    expect(tiersError([t(0), t(12), t(12, 0, false)])).toMatch(/trùng/);
  });
});
