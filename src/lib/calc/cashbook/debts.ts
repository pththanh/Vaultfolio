import type { CalcDebt, CalcEntry } from "./types";

/** Still owed at the end of `asOf`: principal − collected/repaid. */
export function debtRemaining(
  debt: CalcDebt,
  entries: readonly CalcEntry[],
  asOf: string,
): bigint {
  if (asOf < debt.startOn) return 0n;
  let left = debt.principal;
  for (const e of entries)
    if (
      e.debtId === debt.id &&
      (e.type === "collect" || e.type === "repay") &&
      e.occurredOn <= asOf
    )
      left -= e.amount;
  return left;
}

export class DebtError extends Error {
  name = "DebtError";
}

/** Remaining and status after paying `amount`; rejects paying more than is owed. */
export function settleDebt(
  remaining: bigint,
  amount: bigint,
): { remaining: bigint; status: "open" | "settled" } {
  if (amount <= 0n) throw new DebtError("Số tiền phải lớn hơn 0");
  if (amount > remaining) throw new DebtError("Số tiền vượt quá số nợ còn lại");
  const left = remaining - amount;
  return { remaining: left, status: left === 0n ? "settled" : "open" };
}

const SOON_DAYS = 14;

/** Reminder state of an open debt. */
export function debtDue(
  dueOn: string | null,
  today: string,
): "overdue" | "soon" | null {
  if (!dueOn) return null;
  if (dueOn < today) return "overdue";
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + SOON_DAYS);
  return dueOn <= limit.toISOString().slice(0, 10) ? "soon" : null;
}
