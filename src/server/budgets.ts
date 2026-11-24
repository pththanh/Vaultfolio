import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgets, cashEntries, users } from "@/db/schema";
import {
  budgetAlerts,
  budgetsForMonth,
  replaceBudget,
} from "@/lib/calc/cashbook/budget";
import { shiftMonth } from "@/lib/calc/cashbook/report";
import type { CalcCategory, CalcEntry } from "@/lib/calc/cashbook/types";
import { formatVnd } from "@/lib/format";
import { getOwnedCategory, type Tx } from "./cashbook";
import { quickAmount } from "./fields";
import { LedgerError } from "./ledger";

type Db = Pick<Tx, "select">;

export function loadBudgets(userId: string, tx: Db = db) {
  return tx
    .select()
    .from(budgets)
    .where(eq(budgets.userId, userId))
    .orderBy(asc(budgets.createdAt));
}

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Tháng không hợp lệ");
const target = z.object({
  /** "" = total spending. */
  categoryId: z
    .literal("")
    .transform(() => null)
    .or(z.uuid("Chọn hạng mục")),
  month,
  scope: z.enum(["month", "onward"]),
});
export const budgetFormSchema = target.extend({
  amount: quickAmount,
  alertPct: z.coerce
    .number()
    .int()
    .min(1, "Ngưỡng nhắc từ 1 đến 100%")
    .max(100, "Ngưỡng nhắc từ 1 đến 100%"),
});
export const budgetRemoveSchema = target;

type Target = z.infer<typeof target>;

/** Rewrite one category's segments. Call inside a transaction that holds the user's lock. */
async function writeSegments(
  tx: Tx,
  userId: string,
  { categoryId, month, scope }: Target,
  value: { amount: bigint; alertPct: number } | null,
) {
  const where = and(
    eq(budgets.userId, userId),
    sql`${budgets.categoryId} is not distinct from ${categoryId}`,
  );
  const current = await tx.select().from(budgets).where(where);
  const next = replaceBudget(
    current.map(({ effectiveFrom, effectiveTo, amount, alertPct }) => ({
      effectiveFrom,
      effectiveTo,
      amount,
      alertPct,
    })),
    month,
    scope,
    value,
  );
  await tx.delete(budgets).where(where);
  if (next.length)
    await tx
      .insert(budgets)
      .values(next.map((s) => ({ userId, categoryId, ...s })));
}

/** One writer at a time per user, so segments cannot end up overlapping. */
const lockUser = (tx: Tx, userId: string) =>
  tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");

export async function setBudget(
  userId: string,
  form: z.infer<typeof budgetFormSchema>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    if (form.categoryId) {
      const c = await getOwnedCategory(tx, userId, form.categoryId);
      if (c.kind !== "expense")
        throw new LedgerError("Chỉ đặt hạn mức cho hạng mục chi");
    }
    await writeSegments(tx, userId, form, form);
  });
}

export async function removeBudget(
  userId: string,
  form: Target,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    if (form.categoryId) await getOwnedCategory(tx, userId, form.categoryId);
    await writeSegments(tx, userId, form, null);
  });
}

/** Copy last month's budgets that do not already apply to `month`. Returns how many. */
export async function copyPreviousBudgets(
  userId: string,
  to: string,
): Promise<number> {
  month.parse(to);
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const all = await loadBudgets(userId, tx);
    const have = new Set(budgetsForMonth(all, to).map((b) => b.categoryId));
    const missing = budgetsForMonth(all, shiftMonth(to, -1)).filter(
      (b) => !have.has(b.categoryId),
    );
    for (const b of missing)
      await writeSegments(
        tx,
        userId,
        { categoryId: b.categoryId, month: to, scope: "month" },
        { amount: b.amount, alertPct: b.alertPct },
      );
    return missing.length;
  });
}

/** A user's entries of one month, as seen by the transaction. */
export function monthEntries(tx: Db, userId: string, month: string) {
  return tx
    .select()
    .from(cashEntries)
    .where(
      and(
        eq(cashEntries.userId, userId),
        sql`to_char(${cashEntries.occurredOn}, 'YYYY-MM') = ${month}`,
      ),
    );
}

/** Messages for the budgets that a save just pushed over a threshold. */
export async function alertMessages(
  tx: Db,
  userId: string,
  month: string,
  before: readonly CalcEntry[],
  categories: readonly (CalcCategory & { name: string })[],
): Promise<string[]> {
  const active = budgetsForMonth(await loadBudgets(userId, tx), month);
  if (active.length === 0) return [];
  const after = await monthEntries(tx, userId, month);
  return budgetAlerts(active, before, after, categories, month).map(
    ({ budget, state, status }) => {
      const name = budget.categoryId
        ? (categories.find((c) => c.id === budget.categoryId)?.name ?? "")
        : "Tổng chi tháng";
      return state === "over"
        ? status.remaining < 0n
          ? `${name}: vượt hạn mức ${formatVnd(-status.remaining)}`
          : `${name}: đã dùng hết hạn mức ${formatVnd(budget.amount)}`
        : `${name}: đã dùng ${Math.floor(status.ratio * 100)}% hạn mức, còn ${formatVnd(status.remaining)}`;
    },
  );
}
