import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accounts, savingsDeposits, type SavingsDeposit } from "@/db/schema";
import {
  QTY_SCALE,
  divRound,
  parseViMoney,
  parseViNumber,
} from "@/lib/calc/decimal";
import { todayVN } from "@/lib/format";
import { syncSavingsClosing, syncSavingsOpening } from "./cashbook";
import { LedgerError, findOrCreateAccount, getOwnedAccount } from "./ledger";

const NEW_ACCOUNT = "__new";

const viMoney = z
  .string()
  .trim()
  .transform((v, ctx) => {
    try {
      return parseViMoney(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `Số tiền không hợp lệ: "${v}"` });
      return z.NEVER;
    }
  });

/** "5,2" (%/năm) → 520 bps */
const viRate = z
  .string()
  .trim()
  .transform((v, ctx) => {
    try {
      const bps = Number(divRound(parseViNumber(v) * 100n, QTY_SCALE));
      if (bps <= 0 || bps > 5000) throw new Error();
      return bps;
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Lãi suất không hợp lệ (VD: 5,2)",
      });
      return z.NEVER;
    }
  });

export const savingsFormSchema = z.object({
  accountId: z.string().min(1, "Chọn ngân hàng"),
  newAccount: z.string().trim().optional().default(""),
  asset: z.string().trim().min(1, "Nhập tên sổ").max(100),
  quantity: viMoney.refine((v) => v > 0n, "Tiền gốc phải lớn hơn 0"),
  price: viRate,
  termMonths: z.coerce.number().int().min(1).max(120),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ"),
  interestType: z.enum(["end_of_term", "monthly"]).default("end_of_term"),
  rollover: z.enum(["none", "principal", "principal_interest"]).default("none"),
  note: z.string().trim().max(500).optional().default(""),
  /** Wallet the money came from; "" = none, missing = leave as is. */
  sourceWalletId: z.string().optional(),
});
export type SavingsForm = z.infer<typeof savingsFormSchema>;

async function resolveBank(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  form: SavingsForm,
) {
  if (form.accountId === NEW_ACCOUNT) {
    if (!form.newAccount) throw new LedgerError("Nhập tên ngân hàng");
    return findOrCreateAccount(tx, userId, form.newAccount, "savings");
  }
  const account = await getOwnedAccount(tx, userId, form.accountId);
  if (!account) throw new LedgerError("Ngân hàng không tồn tại");
  return account;
}

function values(form: SavingsForm, account: { id: string; name: string }) {
  return {
    accountId: account.id,
    bank: account.name,
    name: form.asset,
    principal: form.quantity,
    rateBps: form.price,
    termMonths: form.termMonths,
    startDate: form.tradeDate,
    interestType: form.interestType,
    rollover: form.rollover,
    note: form.note || null,
  };
}

export async function createSavingsDeposit(userId: string, form: SavingsForm) {
  await db.transaction(async (tx) => {
    const account = await resolveBank(tx, userId, form);
    const [dep] = await tx
      .insert(savingsDeposits)
      .values(values(form, account))
      .returning();
    await syncSavingsOpening(tx, userId, dep, sourceWallet(form));
  });
}

export async function getOwnedDeposit(
  userId: string,
  id: string,
): Promise<SavingsDeposit | null> {
  const [row] = await db
    .select({ d: savingsDeposits })
    .from(savingsDeposits)
    .innerJoin(accounts, eq(savingsDeposits.accountId, accounts.id))
    .where(and(eq(savingsDeposits.id, id), eq(accounts.userId, userId)));
  return row?.d ?? null;
}

export async function updateSavingsDeposit(
  userId: string,
  id: string,
  form: SavingsForm,
) {
  if (!(await getOwnedDeposit(userId, id)))
    throw new LedgerError("Không tìm thấy sổ");
  await db.transaction(async (tx) => {
    const account = await resolveBank(tx, userId, form);
    const [dep] = await tx
      .update(savingsDeposits)
      .set(values(form, account))
      .where(eq(savingsDeposits.id, id))
      .returning();
    await syncSavingsOpening(tx, userId, dep, sourceWallet(form));
    await syncSavingsClosing(tx, userId, dep, undefined);
  });
}

const sourceWallet = (form: SavingsForm) =>
  form.sourceWalletId === undefined ? undefined : form.sourceWalletId || null;

export async function closeSavingsDeposit(
  userId: string,
  id: string,
  closing: { date: string; amount: bigint | null; walletId: string | null },
) {
  const dep = await getOwnedDeposit(userId, id);
  if (!dep) throw new LedgerError("Không tìm thấy sổ");
  if (closing.date < dep.startDate)
    throw new LedgerError("Ngày tất toán phải sau ngày gửi");
  if (closing.date > todayVN())
    throw new LedgerError("Ngày tất toán không được ở tương lai");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(savingsDeposits)
      .set({
        status: "withdrawn",
        closedDate: closing.date,
        closedAmount: closing.amount,
      })
      .where(eq(savingsDeposits.id, id))
      .returning();
    await syncSavingsClosing(tx, userId, row, closing.walletId);
  });
}

export async function reopenSavingsDeposit(userId: string, id: string) {
  if (!(await getOwnedDeposit(userId, id)))
    throw new LedgerError("Không tìm thấy sổ");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(savingsDeposits)
      .set({ status: "active", closedDate: null, closedAmount: null })
      .where(eq(savingsDeposits.id, id))
      .returning();
    await syncSavingsClosing(tx, userId, row, null);
  });
}
