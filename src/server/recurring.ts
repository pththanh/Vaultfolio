import "server-only";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  cashEntries,
  categories,
  recurringRules,
  wallets,
  type Category,
} from "@/db/schema";
import {
  firstOccurrence,
  generateDue,
  nextOccurrence,
} from "@/lib/calc/cashbook/recurring";
import { monthOf } from "@/lib/calc/cashbook/report";
import { CATEGORY_KINDS, RECURRING_FREQS } from "@/lib/calc/cashbook/types";
import { todayVN } from "@/lib/format";
import { alertMessages, monthEntries } from "./budgets";
import {
  getOwnedCategory,
  getOwnedWallet,
  isoDate,
  note,
  optionalId,
  type Tx,
} from "./cashbook";
import { quickAmount } from "./fields";
import { LedgerError } from "./ledger";

export type RecurringRule = typeof recurringRules.$inferSelect;

export const ruleFormSchema = z.object({
  id: optionalId,
  type: z.enum(CATEGORY_KINDS),
  amount: quickAmount,
  walletId: z.string().min(1, "Chọn ví"),
  categoryId: z.string().min(1, "Chọn hạng mục"),
  note,
  freq: z.enum(RECURRING_FREQS),
  day: z.coerce.number().int().min(1).max(31).optional(),
  startOn: isoDate,
  autoPost: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
});

export function loadRules(userId: string): Promise<RecurringRule[]> {
  return db
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.userId, userId))
    .orderBy(asc(recurringRules.nextRunOn), asc(recurringRules.createdAt));
}

/**
 * Rules waiting for the user: manual ones that are due, and automatic ones the
 * daily job could not post (archived wallet, hidden category, missed run).
 */
export function waitingRules(
  rules: readonly RecurringRule[],
  today: string,
): { rule: RecurringRule; count: number }[] {
  return rules.flatMap((rule) => {
    const due = generateDue([rule], today).due;
    const mine = rule.autoPost ? due.filter((d) => d.occurredOn < today) : due;
    return mine.length ? [{ rule, count: mine.length }] : [];
  });
}

async function lockRule(
  tx: Tx,
  userId: string,
  id: string,
): Promise<RecurringRule> {
  const [row] = z.uuid().safeParse(id).success
    ? await tx
        .select()
        .from(recurringRules)
        .where(
          and(eq(recurringRules.id, id), eq(recurringRules.userId, userId)),
        )
        .for("update")
    : [];
  if (!row) throw new LedgerError("Ghi chép định kỳ không tồn tại");
  return row;
}

async function checkedCategory(
  tx: Tx,
  userId: string,
  id: string,
  kind: Category["kind"],
) {
  const c = await getOwnedCategory(tx, userId, id);
  if (c.kind !== kind)
    throw new LedgerError("Hạng mục không khớp loại thu/chi");
  if (c.archivedAt) throw new LedgerError(`Hạng mục "${c.name}" đang ẩn`);
}

export async function saveRule(
  userId: string,
  form: z.infer<typeof ruleFormSchema>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = form.id ? await lockRule(tx, userId, form.id) : undefined;
    const w = await getOwnedWallet(tx, userId, form.walletId);
    if (w.archivedAt) throw new LedgerError(`Ví "${w.name}" đã lưu trữ`);
    await checkedCategory(tx, userId, form.categoryId, form.type);

    const unchanged = existing?.nextRunOn === form.startOn;
    if (!unchanged && form.startOn < todayVN())
      throw new LedgerError("Ngày bắt đầu không được ở quá khứ");
    const day = dayOf(form.freq, form.day, form.startOn);
    const nextRunOn =
      unchanged && existing.freq === form.freq && existing.day === day
        ? existing.nextRunOn
        : firstOccurrence(form.freq, day, form.startOn);
    const values = {
      template: {
        type: form.type,
        amount: form.amount.toString(),
        walletId: form.walletId,
        categoryId: form.categoryId,
        note: form.note,
      },
      freq: form.freq,
      day,
      nextRunOn,
      autoPost: form.autoPost,
    };
    if (existing)
      await tx
        .update(recurringRules)
        .set(values)
        .where(eq(recurringRules.id, existing.id));
    else await tx.insert(recurringRules).values({ userId, ...values });
  });
}

function dayOf(
  freq: RecurringRule["freq"],
  day: number | undefined,
  startOn: string,
): number {
  const dom = Number(startOn.slice(8));
  if (freq === "monthly") return day ?? dom;
  if (freq === "yearly") return dom;
  return new Date(`${startOn}T00:00:00Z`).getUTCDay() || 7;
}

/** Pausing keeps the schedule; resuming skips the runs missed meanwhile. */
export async function setRuleActive(
  userId: string,
  id: string,
  active: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const rule = await lockRule(tx, userId, id);
    let next = rule.nextRunOn;
    if (active && !rule.active)
      while (next < todayVN()) next = nextOccurrence(rule, next);
    await tx
      .update(recurringRules)
      .set({ active, nextRunOn: next })
      .where(eq(recurringRules.id, id));
  });
}

export async function deleteRule(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockRule(tx, userId, id);
    await tx.delete(recurringRules).where(eq(recurringRules.id, id));
  });
}

/** Why a run cannot be posted right now, or null. */
async function blocked(
  tx: Pick<Tx, "select">,
  rule: RecurringRule,
  date: string,
): Promise<string | null> {
  const t = rule.template;
  const [w] = await tx
    .select()
    .from(wallets)
    .where(and(eq(wallets.id, t.walletId), eq(wallets.userId, rule.userId)));
  if (!w || w.archivedAt) return "Ví của ghi chép định kỳ không còn dùng";
  if (date < w.openingDate) return `Ví "${w.name}" chưa bắt đầu vào ngày này`;
  const [c] = await tx
    .select()
    .from(categories)
    .where(
      and(eq(categories.id, t.categoryId), eq(categories.userId, rule.userId)),
    );
  if (!c || c.archivedAt || c.kind !== t.type)
    return "Hạng mục của ghi chép định kỳ không còn dùng";
  return null;
}

/** Insert one run; the unique (rule, date) makes repeating it harmless. */
async function post(tx: Tx, rule: RecurringRule, date: string, amount: bigint) {
  const t = rule.template;
  const rows = await tx
    .insert(cashEntries)
    .values({
      userId: rule.userId,
      type: t.type,
      amount,
      occurredOn: date,
      walletId: t.walletId,
      categoryId: t.categoryId,
      note: t.note || null,
      recurringRuleId: rule.id,
    })
    .onConflictDoNothing()
    .returning({ id: cashEntries.id });
  return rows.length;
}

/** Confirm (with the amount) or skip (null) the next due run of a rule. Returns budget alerts. */
export async function resolveRun(
  userId: string,
  id: string,
  date: string,
  amount: bigint | null,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const rule = await lockRule(tx, userId, id);
    if (!rule.active || rule.nextRunOn !== date || date > todayVN())
      throw new LedgerError("Kỳ này đã được xử lý, hãy tải lại trang");
    const month = monthOf(date);
    const before = await monthEntries(tx, userId, month);
    if (amount !== null) {
      const reason = await blocked(tx, rule, date);
      if (reason) throw new LedgerError(`${reason} — hãy sửa rồi ghi lại`);
      await post(tx, rule, date, amount);
    }
    await tx
      .update(recurringRules)
      .set({ nextRunOn: nextOccurrence(rule, date) })
      .where(eq(recurringRules.id, id));
    const cats = await tx
      .select()
      .from(categories)
      .where(eq(categories.userId, userId));
    return alertMessages(tx, userId, month, before, cats);
  });
}

/** Daily job: post every automatic run due. Blocked rules stay due and wait for the user. */
export async function postRecurring(today: string): Promise<number> {
  const due = await db
    .select({ id: recurringRules.id })
    .from(recurringRules)
    .where(
      and(
        eq(recurringRules.active, true),
        eq(recurringRules.autoPost, true),
        lte(recurringRules.nextRunOn, today),
      ),
    );
  let posted = 0;
  for (const { id } of due)
    posted += await db.transaction(async (tx) => {
      const [rule] = await tx
        .select()
        .from(recurringRules)
        .where(
          and(
            eq(recurringRules.id, id),
            eq(recurringRules.active, true),
            sql`${recurringRules.nextRunOn} <= ${today}`,
          ),
        )
        .for("update");
      if (!rule) return 0;
      let n = 0;
      let next = rule.nextRunOn;
      for (const run of generateDue([rule], today).due) {
        if (await blocked(tx, rule, run.occurredOn)) break;
        n += await post(tx, rule, run.occurredOn, BigInt(rule.template.amount));
        next = nextOccurrence(rule, run.occurredOn);
      }
      if (next !== rule.nextRunOn)
        await tx
          .update(recurringRules)
          .set({ nextRunOn: next })
          .where(eq(recurringRules.id, id));
      return n;
    });
  return posted;
}
