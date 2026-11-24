"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { savingsDeposits } from "@/db/schema";
import { parseAmount } from "@/lib/calc/cashbook/parse-amount";
import { LedgerError } from "@/server/ledger";
import {
  closeSavingsDeposit,
  createSavingsDeposit,
  getOwnedDeposit,
  reopenSavingsDeposit,
  savingsFormSchema,
  updateSavingsDeposit,
} from "@/server/savings";
import { requireUser } from "@/server/session";
import type { FormState } from "../transactions/actions";

function done(message: string): FormState {
  revalidatePath("/admin", "layout");
  return { ok: true, message, nonce: Date.now() };
}

export async function saveSavings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = savingsFormSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    if (raw.id) await updateSavingsDeposit(user.id, raw.id, parsed.data);
    else await createSavingsDeposit(user.id, parsed.data);
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    throw err;
  }
  return done(raw.id ? "Đã cập nhật sổ" : "Đã thêm sổ tiết kiệm");
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function withdrawSavings(
  id: string,
  date: string,
  amountText: string,
  walletId: string,
): Promise<FormState> {
  const user = await requireUser();
  if (!dateSchema.safeParse(date).success)
    return { error: "Ngày không hợp lệ" };
  const amount = amountText.trim() ? parseAmount(amountText) : null;
  if (amountText.trim() && amount === null)
    return { error: `Số tiền không hợp lệ: "${amountText}"` };
  try {
    await closeSavingsDeposit(user.id, id, {
      date,
      amount,
      walletId: walletId || null,
    });
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    throw err;
  }
  return done("Đã tất toán sổ");
}

export async function reopenSavings(id: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await reopenSavingsDeposit(user.id, id);
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    throw err;
  }
  return done("Đã mở lại sổ");
}

export async function deleteSavings(id: string): Promise<FormState> {
  const user = await requireUser();
  if (!(await getOwnedDeposit(user.id, id)))
    return { error: "Không tìm thấy sổ" };
  await db.delete(savingsDeposits).where(eq(savingsDeposits.id, id));
  return done("Đã xoá sổ");
}
