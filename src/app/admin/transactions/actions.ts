"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import {
  mulQty,
  parseDecimal,
  parseViMoney,
  parseViNumber,
  qtyToString,
} from "@/lib/calc/decimal";
import { scaledNavToPrice, toHundreds } from "@/lib/calc/fund/units";
import { tradeCharges } from "@/lib/calc/fees";
import { TX_TYPES } from "@/lib/calc/types";
import { todayVN } from "@/lib/format";
import { parseTransactionsCsv } from "@/lib/csv";
import {
  fundImportOptionsSchema,
  importFundCsv,
  previewFundCsv,
  type FundImportPreview,
} from "@/server/fund-import";
import { fundCharges } from "@/server/funds";
import {
  LedgerError,
  assertConsistent,
  findOrCreateAccount,
  findOrCreateInstrument,
  getOwnedAccount,
  getOwnedTransaction,
} from "@/server/ledger";
import { getFeeConfig } from "@/server/portfolio";
import { createSavingsDeposit, savingsFormSchema } from "@/server/savings";
import { requireUser } from "@/server/session";

export interface FormState {
  ok?: boolean;
  error?: string;
  message?: string;
  warnings?: string[];
  /** Bumps on every success so the client can reset the form. */
  nonce?: number;
}

const NEW_ACCOUNT = "__new";

const viQty = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return 0n;
    try {
      return parseViNumber(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `Số không hợp lệ: "${v}"` });
      return z.NEVER;
    }
  });

const viMoneyOpt = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null;
    try {
      return parseViMoney(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `Số tiền không hợp lệ: "${v}"` });
      return z.NEVER;
    }
  });

const txSchema = z.object({
  id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  cls: z.enum(["stock", "fund", "crypto", "gold"]),
  type: z.enum(TX_TYPES),
  accountId: z.string().min(1, "Chọn tài khoản"),
  newAccount: z.string().trim().optional().default(""),
  asset: z.string().trim().min(1, "Nhập mã tài sản"),
  quantity: viQty,
  /** Read per class: whole đồng, or a NAV with two decimals for funds. */
  price: z.string().trim().optional().default(""),
  fee: viMoneyOpt,
  tax: viMoneyOpt,
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ"),
  note: z.string().trim().max(500).optional().default(""),
});

function done(message: string): FormState {
  revalidatePath("/admin", "layout");
  return { ok: true, message, nonce: Date.now() };
}

function fail(err: unknown): FormState {
  if (err instanceof LedgerError) return { error: err.message };
  if (err instanceof z.ZodError)
    return { error: err.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  throw err;
}

export async function saveTransaction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData) as Record<string, string>;

  if (raw.cls === "savings") {
    const parsed = savingsFormSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    try {
      await createSavingsDeposit(user.id, parsed.data);
      return done("Đã thêm sổ tiết kiệm");
    } catch (err) {
      return fail(err);
    }
  }

  const parsed = txSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;

  // Quantity is the unit count, except standalone fees which only carry an amount.
  const isFund = d.cls === "fund";
  let price: bigint;
  try {
    price = !d.price
      ? 0n
      : isFund
        ? scaledNavToPrice(parseViNumber(d.price))
        : parseViMoney(d.price);
  } catch {
    return { error: `Giá không hợp lệ: "${d.price}"` };
  }
  const quantity = isFund ? toHundreds(d.quantity) : d.quantity;
  if (isFund && d.type !== "buy" && d.type !== "sell")
    return { error: "Quỹ mở chỉ có giao dịch mua và bán" };
  const needsQty = d.type !== "fee";
  const needsPrice =
    d.type === "buy" || d.type === "sell" || d.type === "dividend_cash";
  if (needsQty && quantity <= 0n) return { error: "Số lượng phải lớn hơn 0" };
  if (needsPrice && price <= 0n) return { error: "Giá phải lớn hơn 0" };
  if (d.type === "fee" && (d.fee ?? 0n) <= 0n)
    return { error: "Nhập số tiền phí" };
  if (d.tradeDate > todayVN())
    return { error: "Ngày giao dịch không được ở tương lai" };

  const fees = await getFeeConfig(user.id);
  const gross = mulQty(quantity, price);
  let auto = tradeCharges(d.cls, d.type, gross, fees);

  try {
    await db.transaction(async (tx) => {
      let accountId = d.accountId;
      if (accountId === NEW_ACCOUNT) {
        if (!d.newAccount) throw new LedgerError("Nhập tên tài khoản mới");
        accountId = (
          await findOrCreateAccount(tx, user.id, d.newAccount, d.cls)
        ).id;
      } else if (!(await getOwnedAccount(tx, user.id, accountId))) {
        throw new LedgerError("Tài khoản không tồn tại");
      }
      const instrument = await findOrCreateInstrument(tx, d.cls, d.asset);
      if (isFund && (d.fee === null || d.tax === null))
        auto = await fundCharges(tx, user.id, instrument.id, {
          type: d.type === "sell" ? "sell" : "buy",
          quantity,
          price,
          date: d.tradeDate,
          excludeId: d.id,
          fees,
        });
      const values = {
        accountId,
        instrumentId: instrument.id,
        type: d.type,
        quantity: qtyToString(needsQty ? quantity : 0n),
        price: needsPrice ? price : 0n,
        fee: d.fee ?? auto.fee,
        tax: d.tax ?? auto.tax,
        tradeDate: d.tradeDate,
        note: d.note || null,
      };

      const touched = [instrument.id];
      if (d.id) {
        const existing = await getOwnedTransaction(tx, user.id, d.id);
        if (!existing) throw new LedgerError("Không tìm thấy giao dịch");
        touched.push(existing.instrumentId);
        await tx
          .update(transactions)
          .set(values)
          .where(eq(transactions.id, d.id));
      } else {
        await tx.insert(transactions).values(values);
      }
      await assertConsistent(tx, user.id, touched);
    });
  } catch (err) {
    return fail(err);
  }
  return done(d.id ? "Đã cập nhật giao dịch" : "Đã lưu giao dịch");
}

export async function deleteTransaction(id: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await db.transaction(async (tx) => {
      const existing = await getOwnedTransaction(tx, user.id, id);
      if (!existing) throw new LedgerError("Không tìm thấy giao dịch");
      await tx.delete(transactions).where(eq(transactions.id, id));
      await assertConsistent(tx, user.id, [existing.instrumentId]);
    });
  } catch (err) {
    return fail(err);
  }
  return done("Đã xoá giao dịch");
}

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export async function importTransactions(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { error: "Chọn file CSV" };
  if (file.size > MAX_IMPORT_BYTES)
    return { error: "File quá lớn (tối đa 2 MB)" };

  const { rows, errors } = parseTransactionsCsv(await file.text());
  if (errors.length) {
    const head = errors
      .slice(0, 3)
      .map((e) => `dòng ${e.line}: ${e.message}`)
      .join("; ");
    return { error: `Không nhập được ${errors.length} dòng — ${head}` };
  }
  if (rows.length === 0) return { error: "File không có dòng dữ liệu nào" };

  try {
    await db.transaction(async (tx) => {
      const touched = new Set<string>();
      for (const r of rows) {
        const account = await findOrCreateAccount(
          tx,
          user.id,
          r.account,
          r.assetClass,
        );
        const instrument = await findOrCreateInstrument(
          tx,
          r.assetClass,
          r.symbol,
        );
        touched.add(instrument.id);
        await tx.insert(transactions).values({
          accountId: account.id,
          instrumentId: instrument.id,
          type: r.type,
          quantity: qtyToString(parseDecimal(r.quantity)),
          price: r.price,
          fee: r.fee,
          tax: r.tax,
          tradeDate: r.date,
          note: r.note || null,
        });
      }
      await assertConsistent(tx, user.id, [...touched]);
    });
  } catch (err) {
    return fail(err);
  }
  return done(`Đã nhập ${rows.length} giao dịch`);
}

// ——— Fmarket order history ————————————————————————————————————

async function fundCsvText(fd: FormData): Promise<string> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw new LedgerError("Chọn file CSV");
  if (file.size > MAX_IMPORT_BYTES)
    throw new LedgerError("File quá lớn (tối đa 2 MB)");
  return file.text();
}

export async function previewFundAction(
  fd: FormData,
): Promise<{ preview: FundImportPreview } | { error: string }> {
  const user = await requireUser();
  try {
    return { preview: await previewFundCsv(user.id, await fundCsvText(fd)) };
  } catch (err) {
    return { error: fail(err).error! };
  }
}

export async function importFundAction(fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const options = fundImportOptionsSchema.parse(
      JSON.parse(String(fd.get("options") ?? "{}")),
    );
    const r = await importFundCsv(user.id, await fundCsvText(fd), options);
    return done(
      `Đã nhập ${r.imported} lệnh quỹ${r.duplicates ? `, bỏ qua ${r.duplicates} lệnh trùng` : ""}`,
    );
  } catch (err) {
    if (err instanceof SyntaxError) return { error: "Dữ liệu không hợp lệ" };
    return fail(err);
  }
}
