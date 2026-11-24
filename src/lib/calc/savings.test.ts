import { describe, expect, it } from "vitest";
import {
  daysBetween,
  earlyWithdrawalValue,
  maturityDate,
  savingsSnapshot,
  simpleInterest,
  type SavingsInput,
} from "./savings";

const mb: SavingsInput = {
  principal: 135_000_000n,
  rateBps: 460,
  termMonths: 6,
  startDate: "2026-06-05",
  interestType: "end_of_term",
  rollover: "principal_interest",
  status: "active",
  closedDate: null,
};

describe("date helpers", () => {
  it("maturityDate adds months and clamps to month end", () => {
    expect(maturityDate("2026-06-05", 6)).toBe("2026-12-05");
    expect(maturityDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(maturityDate("2026-06-29", 12)).toBe("2027-06-29");
  });

  it("daysBetween counts calendar days", () => {
    expect(daysBetween("2026-06-05", "2026-11-21")).toBe(169);
    expect(daysBetween("2026-06-05", "2026-12-05")).toBe(183);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });
});

describe("simpleInterest (actual/365)", () => {
  it("computes and rounds", () => {
    expect(simpleInterest(135_000_000n, 460, 169)).toBe(2_875_315n);
    expect(simpleInterest(300_000_000n, 520, 365)).toBe(15_600_000n);
    expect(simpleInterest(1n, 1, 0)).toBe(0n);
  });
});

describe("savingsSnapshot", () => {
  it("accrues interest to date within the term", () => {
    const s = savingsSnapshot(mb, "2026-11-21");
    expect(s.daysElapsed).toBe(169);
    expect(s.termDays).toBe(183);
    expect(s.maturity).toBe("2026-12-05");
    expect(s.accruedInterest).toBe(2_875_315n);
    expect(s.interestAtMaturity).toBe(3_113_507n);
    expect(s.currentValue).toBe(137_875_315n);
    expect(s.daysToMaturity).toBe(14);
    expect(s.matured).toBe(false);
  });

  it("is zero before the start date", () => {
    const s = savingsSnapshot(mb, "2026-06-01");
    expect(s.currentValue).toBe(0n);
    expect(s.started).toBe(false);
  });

  it("rolls over principal + interest", () => {
    const s = savingsSnapshot(mb, "2026-12-15");
    expect(s.cyclesRolled).toBe(1);
    expect(s.cycleStart).toBe("2026-12-05");
    expect(s.principal).toBe(138_113_507n);
    expect(s.daysElapsed).toBe(10);
    expect(s.accruedInterest).toBe(simpleInterest(138_113_507n, 460, 10));
  });

  it("rolls over principal only and pays out interest", () => {
    const s = savingsSnapshot({ ...mb, rollover: "principal" }, "2026-12-15");
    expect(s.principal).toBe(135_000_000n);
    expect(s.paidOutInterest).toBe(3_113_507n);
  });

  it("without rollover stops accruing at maturity", () => {
    const s = savingsSnapshot({ ...mb, rollover: "none" }, "2027-02-01");
    expect(s.matured).toBe(true);
    expect(s.accruedInterest).toBe(3_113_507n);
    expect(s.currentValue).toBe(138_113_507n);
    expect(s.daysToMaturity).toBe(0);
  });

  it("withdrawn deposits are worth nothing from the close date", () => {
    const closed = {
      ...mb,
      status: "withdrawn" as const,
      closedDate: "2026-09-01",
    };
    expect(savingsSnapshot(closed, "2026-09-01").currentValue).toBe(0n);
    expect(savingsSnapshot(closed, "2026-08-31").currentValue).toBeGreaterThan(
      135_000_000n,
    );
  });
});

describe("earlyWithdrawalValue", () => {
  it("pays only the demand rate for elapsed days", () => {
    // 0,1%/năm × 169 ngày
    expect(earlyWithdrawalValue(mb, "2026-11-21", 10)).toBe(
      135_000_000n + 62_507n,
    );
  });
});
