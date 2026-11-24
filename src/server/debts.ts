import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cashEntries, counterparties, debts, type Debt } from "@/db/schema";
import { DebtError, settleDebt } from "@/lib/calc/cashbook/debts";
import {
  LEND_INTEREST_CATEGORY,
  LOAN_INTEREST_CATEGORY,
} from "@/lib/calc/cashbook/default-categories";
import { DEBT_DIRECTIONS } from "@/lib/calc/cashbook/types";
import { formatDate } from "@/lib/format";
import {
  assertNotFuture,
  isoDate,
  note,
  optionalAmount,
  optionalId,
  systemCategory,
  usableWallet,
  type Tx,
} from "./cashbook";
import { quickAmount } from "./fields";
import { LedgerError } from "./ledger";

export const debtFormSchema = z.object({
  id: optionalId,
  direction: z.enum(DEBT_DIRECTIONS),
  counterparty: z.string().trim().min(1, "Nhập tên người vay/cho vay").max(80),
  principal: quickAmount,
  startOn: isoDate,
  dueOn: isoDate.or(z.literal("").transform(() => null)),
  /** "" = money did not go through a wallet (older debt). */
  walletId: z.string().optional().default(""),
  note,
});

export const paymentFormSchema = z.object({
  debtId: z.uuid(),
  amount: quickAmount,
  interest: optionalAmount,
  walletId: z.string().min(1, "Chọn ví"),
  occurredOn: isoDate,
  note,
});

export function loadCounterparties(userId: string) {
  return db
    .select()
    .from(counterparties)
    .where(eq(counterparties.userId, userId))
    .orderBy(asc(counterparties.name));
}

/** The user's debt, locked so payments cannot race each other. */
async function lockDebt(tx: Tx, userId: string, id: string): Promise<Debt> {
  const [row] = z.uuid().safeParse(id).success
    ? await tx
        .select()
        .from(debts)
        .where(and(eq(debts.id, id), eq(debts.userId, userId)))
        .for("update")
    : [];
  if (!row) throw new LedgerError("Khoản vay nợ không tồn tại");
  return row;
}

const debtEntries = (tx: Tx, debtId: string) =>
  tx
    .select()
    .from(cashEntries)
    .where(eq(cashEntries.debtId, debtId))
    .orderBy(asc(cashEntries.occurredOn));

const isPayment = (e: { type: string }) =>
  e.type === "collect" || e.type === "repay";

const paidSoFar = (rows: { type: string; amount: bigint }[]) =>
  rows.reduce((s, e) => (isPayment(e) ? s + e.amount : s), 0n);

export async function saveDebt(
  userId: string,
  form: z.infer<typeof debtFormSchema>,
): Promise<void> {
  assertNotFuture(form.startOn);
  if (form.dueOn && form.dueOn < form.startOn)
    throw new LedgerError("Hạn trả phải sau ngày vay");
  await db.transaction(async (tx) => {
    const existing = form.id ? await lockDebt(tx, userId, form.id) : undefined;
    const rows = existing ? await debtEntries(tx, existing.id) : [];
    const paid = paidSoFar(rows);
    if (form.principal < paid)
      throw new LedgerError("Số gốc không được nhỏ hơn số đã trả");
    const firstPayment = rows.find(isPayment);
    if (firstPayment && form.startOn > firstPayment.occurredOn)
      throw new LedgerError(
        `Đã có khoản trả ngày ${formatDate(firstPayment.occurredOn)}, ngày vay không được muộn hơn`,
      );

    await tx
      .insert(counterparties)
      .values({ userId, name: form.counterparty })
      .onConflictDoNothing();
    const who = (await tx.query.counterparties.findFirst({
      where: and(
        eq(counterparties.userId, userId),
        eq(counterparties.name, form.counterparty),
      ),
    }))!;

    const direction = existing?.direction ?? form.direction;
    const values = {
      counterpartyId: who.id,
      principal: form.principal,
      startOn: form.startOn,
      dueOn: form.dueOn,
      note: form.note || null,
      status:
        paid === form.principal ? ("settled" as const) : ("open" as const),
    };
    let debtId = existing?.id;
    if (debtId) await tx.update(debts).set(values).where(eq(debts.id, debtId));
    else {
      const [row] = await tx
        .insert(debts)
        .values({ userId, direction, ...values })
        .returning({ id: debts.id });
      debtId = row.id;
    }
    if (rows.length)
      await tx
        .update(cashEntries)
        .set({ counterpartyId: who.id })
        .where(eq(cashEntries.debtId, debtId));

    // The money changing hands, when it went through a wallet.
    const initial = rows.find((e) => !isPayment(e));
    if (!form.walletId) {
      if (initial)
        await tx.delete(cashEntries).where(eq(cashEntries.id, initial.id));
      return;
    }
    await usableWallet(tx, userId, form.walletId, form.startOn, [
      initial?.walletId,
    ]);
    const entry = {
      type: direction === "lent" ? ("lend" as const) : ("borrow" as const),
      amount: form.principal,
      occurredOn: form.startOn,
      walletId: form.walletId,
      counterpartyId: who.id,
      note: form.counterparty,
    };
    if (initial)
      await tx
        .update(cashEntries)
        .set({ ...entry, updatedAt: new Date() })
        .where(eq(cashEntries.id, initial.id));
    else await tx.insert(cashEntries).values({ userId, debtId, ...entry });
  });
}

/** Collect (lent) or repay (borrowed); interest is booked as income or expense. */
export async function payDebt(
  userId: string,
  form: z.infer<typeof paymentFormSchema>,
): Promise<"open" | "settled"> {
  assertNotFuture(form.occurredOn);
  return db.transaction(async (tx) => {
    const debt = await lockDebt(tx, userId, form.debtId);
    if (form.occurredOn < debt.startOn)
      throw new LedgerError(`Khoản này bắt đầu từ ${formatDate(debt.startOn)}`);
    await usableWallet(tx, userId, form.walletId, form.occurredOn);
    const paid = paidSoFar(await debtEntries(tx, debt.id));
    let status: "open" | "settled";
    try {
      status = settleDebt(debt.principal - paid, form.amount).status;
    } catch (err) {
      if (err instanceof DebtError) throw new LedgerError(err.message);
      throw err;
    }
    const lent = debt.direction === "lent";
    const common = {
      userId,
      occurredOn: form.occurredOn,
      walletId: form.walletId,
      counterpartyId: debt.counterpartyId,
      note: form.note || null,
    };
    const [payment] = await tx
      .insert(cashEntries)
      .values({
        ...common,
        type: lent ? "collect" : "repay",
        amount: form.amount,
        debtId: debt.id,
      })
      .returning({ id: cashEntries.id });
    if (form.interest !== null)
      await tx.insert(cashEntries).values({
        ...common,
        type: lent ? "income" : "expense",
        amount: form.interest,
        categoryId: lent
          ? await systemCategory(tx, userId, "income", LEND_INTEREST_CATEGORY)
          : await systemCategory(tx, userId, "expense", LOAN_INTEREST_CATEGORY),
        parentEntryId: payment.id,
      });
    await tx.update(debts).set({ status }).where(eq(debts.id, debt.id));
    return status;
  });
}

export async function deletePayment(
  userId: string,
  entryId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const e = z.uuid().safeParse(entryId).success
      ? await tx.query.cashEntries.findFirst({
          where: and(
            eq(cashEntries.id, entryId),
            eq(cashEntries.userId, userId),
            inArray(cashEntries.type, ["collect", "repay"]),
          ),
        })
      : undefined;
    if (!e?.debtId) throw new LedgerError("Không tìm thấy khoản trả");
    await lockDebt(tx, userId, e.debtId);
    await tx.delete(cashEntries).where(eq(cashEntries.id, e.id));
    await tx
      .update(debts)
      .set({ status: "open" })
      .where(eq(debts.id, e.debtId));
  });
}

/** Deletes the debt with its wallet entries and interest. */
export async function deleteDebt(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockDebt(tx, userId, id);
    await tx.delete(cashEntries).where(eq(cashEntries.debtId, id));
    await tx.delete(debts).where(eq(debts.id, id));
  });
}
